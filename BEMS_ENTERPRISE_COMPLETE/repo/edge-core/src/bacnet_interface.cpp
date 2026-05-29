#include "bacnet_interface.h"

#include <arpa/inet.h>
#include <cerrno>
#include <cstring>
#include <iostream>
#include <map>
#include <mutex>
#include <netinet/in.h>
#include <optional>
#include <string>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#include <vector>

namespace {

constexpr uint8_t BVLC_TYPE_BACNET_IP = 0x81;
constexpr uint8_t BVLC_ORIGINAL_UNICAST_NPDU = 0x0A;
constexpr uint8_t BVLC_ORIGINAL_BROADCAST_NPDU = 0x0B;
constexpr uint8_t NPDU_VERSION = 0x01;
constexpr uint8_t NPDU_CONTROL_EXPECTING_REPLY = 0x04;
constexpr uint8_t APDU_CONFIRMED_REQUEST = 0x00;
constexpr uint8_t APDU_COMPLEX_ACK = 0x30;
constexpr uint8_t APDU_UNCONFIRMED_REQUEST = 0x10;
constexpr uint8_t SERVICE_I_AM = 0x00;
constexpr uint8_t SERVICE_WHO_IS = 0x08;
constexpr uint8_t SERVICE_READ_PROPERTY = 0x0C;
constexpr uint8_t SERVICE_WRITE_PROPERTY = 0x0F;
constexpr uint32_t OBJECT_TYPE_DEVICE = 8;
constexpr uint32_t PROPERTY_PRESENT_VALUE = 85;

struct BacnetContext {
    int socketFd = -1;
    uint16_t port = 47808;
    uint8_t invokeId = 1;
    std::map<int, sockaddr_in> deviceAddresses;
    std::mutex mutex;
};

BacnetContext context;

void appendUint16(std::vector<uint8_t> &buffer, uint16_t value) {
    buffer.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    buffer.push_back(static_cast<uint8_t>(value & 0xFF));
}

void appendUint32(std::vector<uint8_t> &buffer, uint32_t value) {
    buffer.push_back(static_cast<uint8_t>((value >> 24) & 0xFF));
    buffer.push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
    buffer.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    buffer.push_back(static_cast<uint8_t>(value & 0xFF));
}

uint32_t readUint32(const uint8_t *data) {
    return (static_cast<uint32_t>(data[0]) << 24) |
           (static_cast<uint32_t>(data[1]) << 16) |
           (static_cast<uint32_t>(data[2]) << 8) |
           static_cast<uint32_t>(data[3]);
}

uint32_t objectId(uint32_t objectType, uint32_t objectInstance) {
    return ((objectType & 0x03FF) << 22) | (objectInstance & 0x003FFFFF);
}

std::string objectTypeName(int objectType) {
    switch (objectType) {
    case 0:
        return "analogInput";
    case 1:
        return "analogOutput";
    case 2:
        return "analogValue";
    case 3:
        return "binaryInput";
    case 4:
        return "binaryOutput";
    case 5:
        return "binaryValue";
    case 8:
        return "device";
    default:
        return "objectType" + std::to_string(objectType);
    }
}

void appendContextObjectId(std::vector<uint8_t> &buffer, uint8_t tagNumber, uint32_t type, uint32_t instance) {
    buffer.push_back(static_cast<uint8_t>((tagNumber << 4) | 0x08 | 0x04));
    appendUint32(buffer, objectId(type, instance));
}

void appendContextUnsigned(std::vector<uint8_t> &buffer, uint8_t tagNumber, uint32_t value) {
    if (value <= 0xFF) {
        buffer.push_back(static_cast<uint8_t>((tagNumber << 4) | 0x08 | 0x01));
        buffer.push_back(static_cast<uint8_t>(value));
    } else if (value <= 0xFFFF) {
        buffer.push_back(static_cast<uint8_t>((tagNumber << 4) | 0x08 | 0x02));
        appendUint16(buffer, static_cast<uint16_t>(value));
    } else {
        buffer.push_back(static_cast<uint8_t>((tagNumber << 4) | 0x08 | 0x04));
        appendUint32(buffer, value);
    }
}

void appendApplicationReal(std::vector<uint8_t> &buffer, double value) {
    float encoded = static_cast<float>(value);
    uint32_t bits = 0;
    static_assert(sizeof(bits) == sizeof(encoded), "BACnet REAL expects 32-bit float");
    std::memcpy(&bits, &encoded, sizeof(bits));
    bits = htonl(bits);
    buffer.push_back(0x44);
    const auto *raw = reinterpret_cast<const uint8_t *>(&bits);
    buffer.insert(buffer.end(), raw, raw + sizeof(bits));
}

std::vector<uint8_t> withBvlc(uint8_t function, const std::vector<uint8_t> &npduAndApdu) {
    std::vector<uint8_t> packet;
    packet.reserve(npduAndApdu.size() + 4);
    packet.push_back(BVLC_TYPE_BACNET_IP);
    packet.push_back(function);
    appendUint16(packet, static_cast<uint16_t>(npduAndApdu.size() + 4));
    packet.insert(packet.end(), npduAndApdu.begin(), npduAndApdu.end());
    return packet;
}

bool sendPacket(const std::vector<uint8_t> &packet, const sockaddr_in &address) {
    const auto sent = sendto(context.socketFd, packet.data(), packet.size(), 0,
                             reinterpret_cast<const sockaddr *>(&address), sizeof(address));
    return sent == static_cast<ssize_t>(packet.size());
}

sockaddr_in broadcastAddress() {
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(context.port);
    address.sin_addr.s_addr = INADDR_BROADCAST;
    return address;
}

std::optional<std::pair<std::vector<uint8_t>, sockaddr_in>> receivePacket(int timeoutMs) {
    fd_set readSet;
    FD_ZERO(&readSet);
    FD_SET(context.socketFd, &readSet);

    timeval timeout{};
    timeout.tv_sec = timeoutMs / 1000;
    timeout.tv_usec = (timeoutMs % 1000) * 1000;

    const int ready = select(context.socketFd + 1, &readSet, nullptr, nullptr, &timeout);
    if (ready <= 0) {
        return std::nullopt;
    }

    std::vector<uint8_t> buffer(1500);
    sockaddr_in source{};
    socklen_t sourceLength = sizeof(source);
    const auto received = recvfrom(context.socketFd, buffer.data(), buffer.size(), 0,
                                   reinterpret_cast<sockaddr *>(&source), &sourceLength);
    if (received <= 0) {
        return std::nullopt;
    }

    buffer.resize(static_cast<size_t>(received));
    return std::make_pair(std::move(buffer), source);
}

size_t apduOffset(const std::vector<uint8_t> &packet) {
    if (packet.size() < 6 || packet[0] != BVLC_TYPE_BACNET_IP || packet[4] != NPDU_VERSION) {
        return 0;
    }

    size_t offset = 6;
    const uint8_t control = packet[5];
    if (control & 0x20) {
        if (packet.size() < offset + 3) {
            return 0;
        }
        const uint8_t destinationLength = packet[offset + 2];
        offset += 3 + destinationLength;
        if (packet.size() < offset + 1) {
            return 0;
        }
        offset += 1;
    }
    if (control & 0x08) {
        if (packet.size() < offset + 3) {
            return 0;
        }
        const uint8_t sourceLength = packet[offset + 2];
        offset += 3 + sourceLength;
    }
    if (control & 0x80) {
        return 0;
    }

    return offset < packet.size() ? offset : 0;
}

std::vector<uint8_t> makeWhoIs(int deviceInstance) {
    std::vector<uint8_t> npduApdu{NPDU_VERSION, 0x00, APDU_UNCONFIRMED_REQUEST, SERVICE_WHO_IS};
    if (deviceInstance >= 0) {
        appendContextUnsigned(npduApdu, 0, static_cast<uint32_t>(deviceInstance));
        appendContextUnsigned(npduApdu, 1, static_cast<uint32_t>(deviceInstance));
    }
    return withBvlc(BVLC_ORIGINAL_BROADCAST_NPDU, npduApdu);
}

bool parseIAm(const std::vector<uint8_t> &packet, BacnetDeviceInfo *outInfo) {
    const size_t offset = apduOffset(packet);
    if (!offset || packet.size() < offset + 8) {
        return false;
    }
    if (packet[offset] != APDU_UNCONFIRMED_REQUEST || packet[offset + 1] != SERVICE_I_AM) {
        return false;
    }
    if (packet[offset + 2] != 0xC4) {
        return false;
    }

    const uint32_t encodedObject = readUint32(&packet[offset + 3]);
    const int objectType = static_cast<int>((encodedObject >> 22) & 0x03FF);
    const int instance = static_cast<int>(encodedObject & 0x003FFFFF);
    if (objectType != static_cast<int>(OBJECT_TYPE_DEVICE)) {
        return false;
    }

    if (outInfo) {
        outInfo->deviceInstance = instance;
        outInfo->objectInstance = instance;
        outInfo->objectName = "BACnet Device";
        outInfo->objectType = "device";
        outInfo->units = "";
        outInfo->presentValue = 0.0;
        outInfo->status = "discovered";
    }
    return true;
}

std::optional<sockaddr_in> discoverAddressLocked(int deviceInstance, BacnetDeviceInfo *outInfo) {
    const auto cached = context.deviceAddresses.find(deviceInstance);
    if (cached != context.deviceAddresses.end()) {
        if (outInfo) {
            outInfo->deviceInstance = deviceInstance;
            outInfo->objectInstance = deviceInstance;
            outInfo->objectName = "BACnet Device";
            outInfo->objectType = "device";
            outInfo->units = "";
            outInfo->presentValue = 0.0;
            outInfo->status = "cached";
        }
        return cached->second;
    }

    const auto packet = makeWhoIs(deviceInstance);
    const auto broadcast = broadcastAddress();
    if (!sendPacket(packet, broadcast)) {
        std::cerr << "[BACnet] Who-Is send failed: " << std::strerror(errno) << std::endl;
        return std::nullopt;
    }

    const int attempts = 8;
    for (int i = 0; i < attempts; ++i) {
        auto received = receivePacket(750);
        if (!received) {
            continue;
        }

        BacnetDeviceInfo info{};
        if (!parseIAm(received->first, &info)) {
            continue;
        }

        context.deviceAddresses[info.deviceInstance] = received->second;
        if (info.deviceInstance == deviceInstance) {
            if (outInfo) {
                *outInfo = info;
            }
            return received->second;
        }
    }

    return std::nullopt;
}

uint8_t nextInvokeId() {
    if (++context.invokeId == 0) {
        context.invokeId = 1;
    }
    return context.invokeId;
}

std::vector<uint8_t> makeReadProperty(uint8_t invokeId, int objectType, int objectInstance) {
    std::vector<uint8_t> npduApdu{NPDU_VERSION, NPDU_CONTROL_EXPECTING_REPLY, APDU_CONFIRMED_REQUEST, 0x05, invokeId, SERVICE_READ_PROPERTY};
    appendContextObjectId(npduApdu, 0, static_cast<uint32_t>(objectType), static_cast<uint32_t>(objectInstance));
    appendContextUnsigned(npduApdu, 1, PROPERTY_PRESENT_VALUE);
    return withBvlc(BVLC_ORIGINAL_UNICAST_NPDU, npduApdu);
}

std::vector<uint8_t> makeWriteProperty(uint8_t invokeId, int objectType, int objectInstance, double value) {
    std::vector<uint8_t> npduApdu{NPDU_VERSION, NPDU_CONTROL_EXPECTING_REPLY, APDU_CONFIRMED_REQUEST, 0x05, invokeId, SERVICE_WRITE_PROPERTY};
    appendContextObjectId(npduApdu, 0, static_cast<uint32_t>(objectType), static_cast<uint32_t>(objectInstance));
    appendContextUnsigned(npduApdu, 1, PROPERTY_PRESENT_VALUE);
    npduApdu.push_back(0x3E);
    appendApplicationReal(npduApdu, value);
    npduApdu.push_back(0x3F);
    return withBvlc(BVLC_ORIGINAL_UNICAST_NPDU, npduApdu);
}

std::optional<double> decodeApplicationValue(const std::vector<uint8_t> &packet, size_t offset) {
    if (offset >= packet.size()) {
        return std::nullopt;
    }

    const uint8_t tag = packet[offset++];
    const uint8_t tagNumber = tag >> 4;
    const uint8_t length = tag & 0x07;

    if (tagNumber == 4 && length == 4 && packet.size() >= offset + 4) {
        uint32_t bits = readUint32(&packet[offset]);
        float value = 0.0F;
        std::memcpy(&value, &bits, sizeof(value));
        return static_cast<double>(value);
    }

    if ((tagNumber == 2 || tagNumber == 9) && length >= 1 && length <= 4 && packet.size() >= offset + length) {
        uint32_t value = 0;
        for (uint8_t i = 0; i < length; ++i) {
            value = (value << 8) | packet[offset + i];
        }
        return static_cast<double>(value);
    }

    if (tagNumber == 1) {
        return static_cast<double>(length != 0);
    }

    return std::nullopt;
}

std::optional<double> parseReadPropertyAck(const std::vector<uint8_t> &packet, uint8_t invokeId) {
    const size_t offset = apduOffset(packet);
    if (!offset || packet.size() < offset + 4) {
        return std::nullopt;
    }
    if ((packet[offset] & 0xF0) != APDU_COMPLEX_ACK || packet[offset + 1] != invokeId || packet[offset + 2] != SERVICE_READ_PROPERTY) {
        return std::nullopt;
    }

    for (size_t i = offset + 3; i < packet.size(); ++i) {
        if (packet[i] == 0x3E) {
            return decodeApplicationValue(packet, i + 1);
        }
    }
    return std::nullopt;
}

bool parseSimpleAck(const std::vector<uint8_t> &packet, uint8_t invokeId, uint8_t serviceChoice) {
    const size_t offset = apduOffset(packet);
    if (!offset || packet.size() < offset + 3) {
        return false;
    }

    constexpr uint8_t APDU_SIMPLE_ACK = 0x20;
    return (packet[offset] & 0xF0) == APDU_SIMPLE_ACK && packet[offset + 1] == invokeId && packet[offset + 2] == serviceChoice;
}

bool initializeSocket(const char *localIpAddress, uint16_t localPort) {
    context.socketFd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (context.socketFd < 0) {
        std::cerr << "[BACnet] Socket creation failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    int enabled = 1;
    setsockopt(context.socketFd, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
    setsockopt(context.socketFd, SOL_SOCKET, SO_BROADCAST, &enabled, sizeof(enabled));

    sockaddr_in local{};
    local.sin_family = AF_INET;
    local.sin_port = htons(localPort);
    if (localIpAddress && std::strlen(localIpAddress) > 0 && std::strcmp(localIpAddress, "0.0.0.0") != 0) {
        if (inet_pton(AF_INET, localIpAddress, &local.sin_addr) != 1) {
            std::cerr << "[BACnet] Invalid local IP address: " << localIpAddress << std::endl;
            close(context.socketFd);
            context.socketFd = -1;
            return false;
        }
    } else {
        local.sin_addr.s_addr = INADDR_ANY;
    }

    if (bind(context.socketFd, reinterpret_cast<sockaddr *>(&local), sizeof(local)) != 0) {
        std::cerr << "[BACnet] Bind failed for " << (localIpAddress ? localIpAddress : "0.0.0.0")
                  << ":" << localPort << ": " << std::strerror(errno) << std::endl;
        close(context.socketFd);
        context.socketFd = -1;
        return false;
    }

    context.port = localPort;
    return true;
}

} // namespace

bool bacnet_initialize(const char *localDeviceId, const char *localIpAddress, uint16_t localPort) {
    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.socketFd >= 0) {
        return true;
    }

    std::cout << "[BACnet] Initializing BACnet/IP client: " << (localDeviceId ? localDeviceId : "EdgeCoreDevice")
              << " @ " << (localIpAddress ? localIpAddress : "0.0.0.0") << ":" << localPort << std::endl;
    return initializeSocket(localIpAddress, localPort);
}

bool bacnet_discover_device(int deviceInstance, BacnetDeviceInfo *outInfo) {
    if (!outInfo || context.socketFd < 0) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    const auto address = discoverAddressLocked(deviceInstance, outInfo);
    if (!address) {
        std::cerr << "[BACnet] Device discovery timed out for instance " << deviceInstance << std::endl;
        return false;
    }

    char ip[INET_ADDRSTRLEN] = {};
    inet_ntop(AF_INET, &address->sin_addr, ip, sizeof(ip));
    std::cout << "[BACnet] Discovered device " << deviceInstance << " at " << ip << ":" << ntohs(address->sin_port) << std::endl;
    return true;
}

bool bacnet_read_property(int deviceInstance, int objectType, int objectInstance, double *outValue) {
    if (!outValue || context.socketFd < 0) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    const auto address = discoverAddressLocked(deviceInstance, nullptr);
    if (!address) {
        return false;
    }

    const uint8_t invokeId = nextInvokeId();
    const auto packet = makeReadProperty(invokeId, objectType, objectInstance);
    if (!sendPacket(packet, *address)) {
        std::cerr << "[BACnet] ReadProperty send failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    for (int i = 0; i < 5; ++i) {
        auto received = receivePacket(1000);
        if (!received) {
            continue;
        }
        auto value = parseReadPropertyAck(received->first, invokeId);
        if (value) {
            *outValue = *value;
            return true;
        }
    }

    std::cerr << "[BACnet] ReadProperty timed out for device=" << deviceInstance
              << " objectType=" << objectTypeName(objectType)
              << " objectInstance=" << objectInstance << std::endl;
    return false;
}

bool bacnet_write_property(int deviceInstance, int objectType, int objectInstance, double value) {
    if (context.socketFd < 0) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    const auto address = discoverAddressLocked(deviceInstance, nullptr);
    if (!address) {
        return false;
    }

    const uint8_t invokeId = nextInvokeId();
    const auto packet = makeWriteProperty(invokeId, objectType, objectInstance, value);
    if (!sendPacket(packet, *address)) {
        std::cerr << "[BACnet] WriteProperty send failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    for (int i = 0; i < 5; ++i) {
        auto received = receivePacket(1000);
        if (!received) {
            continue;
        }
        if (parseSimpleAck(received->first, invokeId, SERVICE_WRITE_PROPERTY)) {
            return true;
        }
    }

    std::cerr << "[BACnet] WriteProperty timed out for device=" << deviceInstance
              << " objectType=" << objectTypeName(objectType)
              << " objectInstance=" << objectInstance << std::endl;
    return false;
}

void bacnet_shutdown(void) {
    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.socketFd >= 0) {
        close(context.socketFd);
        context.socketFd = -1;
        context.deviceAddresses.clear();
        std::cout << "[BACnet] BACnet/IP client shut down" << std::endl;
    }
}
