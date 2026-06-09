#include "bacnet_interface.h"
#include "bacnet_object_database.h"
#include "unique_fd.h"

#include <arpa/inet.h>
#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <memory>
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
// BACnet service names: ConfirmedCOVNotification and UnconfirmedCOVNotification.
constexpr uint8_t SERVICE_CONFIRMED_COV_NOTIFICATION = 0x01;
constexpr uint8_t SERVICE_UNCONFIRMED_COV_NOTIFICATION = 0x02;
constexpr uint8_t SERVICE_SUBSCRIBE_COV = 0x05;
constexpr uint8_t SERVICE_WHO_IS = 0x08;
constexpr uint8_t SERVICE_READ_PROPERTY = 0x0C;
constexpr uint8_t SERVICE_READ_PROPERTY_MULTIPLE = 0x0E;
constexpr uint8_t SERVICE_WRITE_PROPERTY = 0x0F;
constexpr uint32_t OBJECT_TYPE_DEVICE = 8;
constexpr uint32_t PROPERTY_PRESENT_VALUE = 85;

struct BacnetContext {
    UniqueFd socketFd;
    uint16_t port = 47808;
    uint8_t invokeId = 1;
    bool simulatorEnabled = false;
    std::map<int, sockaddr_in> deviceAddresses;
    std::mutex mutex;
};

BacnetContext context;

struct SimulatedBacnetDevice {
    int deviceInstance;
    int objectType;
    int objectInstance;
    std::string objectName;
    std::string objectTypeName;
    std::string vendor;
    std::string model;
    std::string ipAddress;
    std::string units;
    double presentValue;
    std::string status;
};

std::map<int, SimulatedBacnetDevice> simulatedDevices;

struct SimulatedCovSubscription {
    int deviceInstance;
    int objectType;
    int objectInstance;
    uint32_t subscriberProcessId;
    bool confirmedNotifications;
};

std::vector<SimulatedCovSubscription> simulatedCovSubscriptions;
std::vector<BacnetCovNotification> simulatedCovNotifications;
std::unique_ptr<BacnetDeviceObjectDatabase> serverObjectDatabase;

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
    case 17:
        return "schedule";
    default:
        return "objectType" + std::to_string(objectType);
    }
}

bool envEnabled(const char *name) {
    const char *value = std::getenv(name);
    if (!value) {
        return false;
    }
    return std::strcmp(value, "1") == 0 ||
           std::strcmp(value, "true") == 0 ||
           std::strcmp(value, "TRUE") == 0 ||
           std::strcmp(value, "yes") == 0 ||
           std::strcmp(value, "YES") == 0;
}

void ensureSimulatedDevicesLocked() {
    if (!simulatedDevices.empty()) {
        return;
    }

    const std::vector<SimulatedBacnetDevice> devices = {
        {101, 0, 1, "SIM Lobby Temperature", "analogInput", "BEMS Simulator", "SIM-TEMP-100", "10.10.0.101", "Celsius", 22.4, "simulated"},
        {102, 1, 1, "SIM Floor 1 VAV Damper", "analogOutput", "BEMS Simulator", "SIM-VAV-200", "10.10.0.102", "Percent", 55.0, "simulated"},
        {103, 0, 1, "SIM Floor 2 Temperature", "analogInput", "BEMS Simulator", "SIM-TEMP-100", "10.10.0.103", "Celsius", 21.8, "simulated"},
        {201, 4, 1, "SIM Floor 1 Supply Fan", "binaryOutput", "BEMS Simulator", "SIM-FAN-75", "10.10.0.201", "On/Off", 1.0, "simulated"},
        {250, 17, 1, "SIM Occupancy Schedule", "schedule", "BEMS Simulator", "SIM-SCHED-1", "10.10.0.250", "Schedule", 1.0, "simulated"},
        {301, 4, 1, "SIM Tower B Lobby Light", "binaryOutput", "BEMS Simulator", "SIM-LIGHT-10", "10.10.0.301", "On/Off", 0.0, "simulated"},
        {302, 1, 1, "SIM Tower B Damper", "analogOutput", "BEMS Simulator", "SIM-DAMPER-90", "10.10.0.302", "Percent", 42.0, "simulated"},
    };

    for (const auto &device : devices) {
        simulatedDevices.emplace(device.deviceInstance, device);
    }
}

BacnetDeviceObjectDatabase &ensureServerObjectDatabaseLocked() {
    if (!serverObjectDatabase) {
        serverObjectDatabase = std::make_unique<BacnetDeviceObjectDatabase>(
            BacnetDeviceObjectDatabase::createDefaultServerDevice(4194303));
    }
    return *serverObjectDatabase;
}

void populateSimulatedInfo(const SimulatedBacnetDevice &device, BacnetDeviceInfo *outInfo) {
    if (!outInfo) {
        return;
    }
    outInfo->deviceInstance = device.deviceInstance;
    outInfo->objectInstance = device.objectInstance;
    outInfo->objectName = device.objectName.c_str();
    outInfo->objectType = device.objectTypeName.c_str();
    outInfo->vendor = device.vendor.c_str();
    outInfo->model = device.model.c_str();
    outInfo->ipAddress = device.ipAddress.c_str();
    outInfo->units = device.units.c_str();
    outInfo->presentValue = device.presentValue;
    outInfo->status = device.status.c_str();
}

SimulatedBacnetDevice *findSimulatedPointLocked(int deviceInstance, int objectType, int objectInstance) {
    auto device = simulatedDevices.find(deviceInstance);
    if (device == simulatedDevices.end()) {
        return nullptr;
    }

    if (device->second.objectType == objectType && device->second.objectInstance == objectInstance) {
        return &device->second;
    }

    if (objectType == static_cast<int>(OBJECT_TYPE_DEVICE)) {
        return &device->second;
    }

    return nullptr;
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

void appendContextBoolean(std::vector<uint8_t> &buffer, uint8_t tagNumber, bool value) {
    buffer.push_back(static_cast<uint8_t>((tagNumber << 4) | 0x08 | 0x01));
    buffer.push_back(value ? 1 : 0);
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
    const auto sent = sendto(context.socketFd.get(), packet.data(), packet.size(), 0,
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
    FD_SET(context.socketFd.get(), &readSet);

    timeval timeout{};
    timeout.tv_sec = timeoutMs / 1000;
    timeout.tv_usec = (timeoutMs % 1000) * 1000;

    const int ready = select(context.socketFd.get() + 1, &readSet, nullptr, nullptr, &timeout);
    if (ready <= 0) {
        return std::nullopt;
    }

    std::vector<uint8_t> buffer(1500);
    sockaddr_in source{};
    socklen_t sourceLength = sizeof(source);
    const auto received = recvfrom(context.socketFd.get(), buffer.data(), buffer.size(), 0,
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
        outInfo->vendor = "Unknown";
        outInfo->model = "Unknown";
        outInfo->ipAddress = "";
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
            outInfo->vendor = "Unknown";
            outInfo->model = "Unknown";
            outInfo->ipAddress = "";
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

std::optional<double> decodeApplicationValue(const std::vector<uint8_t> &packet, size_t offset);

std::vector<uint8_t> makeReadProperty(uint8_t invokeId, int objectType, int objectInstance) {
    std::vector<uint8_t> npduApdu{NPDU_VERSION, NPDU_CONTROL_EXPECTING_REPLY, APDU_CONFIRMED_REQUEST, 0x05, invokeId, SERVICE_READ_PROPERTY};
    appendContextObjectId(npduApdu, 0, static_cast<uint32_t>(objectType), static_cast<uint32_t>(objectInstance));
    appendContextUnsigned(npduApdu, 1, PROPERTY_PRESENT_VALUE);
    return withBvlc(BVLC_ORIGINAL_UNICAST_NPDU, npduApdu);
}

std::vector<uint8_t> makeReadPropertyMultiple(uint8_t invokeId, const BacnetReadPropertyRequest *requests, size_t requestCount) {
    std::vector<uint8_t> npduApdu{NPDU_VERSION, NPDU_CONTROL_EXPECTING_REPLY, APDU_CONFIRMED_REQUEST, 0x05, invokeId, SERVICE_READ_PROPERTY_MULTIPLE};
    for (size_t i = 0; i < requestCount; ++i) {
        appendContextObjectId(npduApdu, 0, static_cast<uint32_t>(requests[i].objectType), static_cast<uint32_t>(requests[i].objectInstance));
        npduApdu.push_back(0x1E);
        appendContextUnsigned(npduApdu, 0, PROPERTY_PRESENT_VALUE);
        npduApdu.push_back(0x1F);
    }
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

std::vector<double> parseReadPropertyMultipleAck(const std::vector<uint8_t> &packet, uint8_t invokeId) {
    std::vector<double> values;
    const size_t offset = apduOffset(packet);
    if (!offset || packet.size() < offset + 4) {
        return values;
    }
    if ((packet[offset] & 0xF0) != APDU_COMPLEX_ACK || packet[offset + 1] != invokeId || packet[offset + 2] != SERVICE_READ_PROPERTY_MULTIPLE) {
        return values;
    }

    for (size_t i = offset + 3; i < packet.size(); ++i) {
        if (packet[i] == 0x3E) {
            auto value = decodeApplicationValue(packet, i + 1);
            if (value) {
                values.push_back(*value);
            }
        }
    }
    return values;
}

std::vector<uint8_t> makeSubscribeCov(uint8_t invokeId,
                                      int objectType,
                                      int objectInstance,
                                      uint32_t subscriberProcessId,
                                      uint32_t lifetimeSeconds,
                                      bool confirmedNotifications) {
    std::vector<uint8_t> npduApdu{NPDU_VERSION, NPDU_CONTROL_EXPECTING_REPLY, APDU_CONFIRMED_REQUEST, 0x05, invokeId, SERVICE_SUBSCRIBE_COV};
    appendContextUnsigned(npduApdu, 0, subscriberProcessId);
    appendContextObjectId(npduApdu, 1, static_cast<uint32_t>(objectType), static_cast<uint32_t>(objectInstance));
    appendContextBoolean(npduApdu, 2, confirmedNotifications);
    appendContextUnsigned(npduApdu, 3, lifetimeSeconds);
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

std::vector<uint8_t> makeSimpleAck(uint8_t invokeId, uint8_t serviceChoice) {
    return withBvlc(BVLC_ORIGINAL_UNICAST_NPDU, {NPDU_VERSION, 0x00, 0x20, invokeId, serviceChoice});
}

std::optional<BacnetCovNotification> parseCovNotification(const std::vector<uint8_t> &packet, uint8_t *invokeId) {
    const size_t offset = apduOffset(packet);
    if (!offset || packet.size() < offset + 3) {
        return std::nullopt;
    }

    BacnetCovNotification notification{};
    size_t cursor = offset;
    uint8_t serviceChoice = 0;
    if ((packet[cursor] & 0xF0) == APDU_CONFIRMED_REQUEST && packet.size() >= cursor + 4) {
        notification.confirmed = true;
        if (invokeId) {
            *invokeId = packet[cursor + 2];
        }
        serviceChoice = packet[cursor + 3];
        cursor += 4;
    } else if ((packet[cursor] & 0xF0) == APDU_UNCONFIRMED_REQUEST && packet.size() >= cursor + 2) {
        notification.confirmed = false;
        serviceChoice = packet[cursor + 1];
        cursor += 2;
    } else {
        return std::nullopt;
    }

    if (serviceChoice != SERVICE_CONFIRMED_COV_NOTIFICATION && serviceChoice != SERVICE_UNCONFIRMED_COV_NOTIFICATION) {
        return std::nullopt;
    }

    for (size_t i = cursor; i + 1 < packet.size(); ++i) {
        const uint8_t tag = packet[i];
        if ((tag & 0xF8) == 0x08 && (tag & 0x07) == 1) {
            notification.subscriberProcessId = packet[i + 1];
        }
        if (packet[i] == 0x1C && i + 4 < packet.size()) {
            const uint32_t encodedObject = readUint32(&packet[i + 1]);
            notification.objectType = static_cast<int>((encodedObject >> 22) & 0x03FF);
            notification.objectInstance = static_cast<int>(encodedObject & 0x003FFFFF);
        }
        if (packet[i] == 0x3E) {
            auto value = decodeApplicationValue(packet, i + 1);
            if (value) {
                notification.value = *value;
                return notification;
            }
        }
    }

    return std::nullopt;
}

bool initializeSocket(const char *localIpAddress, uint16_t localPort) {
    UniqueFd socketFd(socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP));
    if (!socketFd) {
        std::cerr << "[BACnet] Socket creation failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    int enabled = 1;
    setsockopt(socketFd.get(), SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
    setsockopt(socketFd.get(), SOL_SOCKET, SO_BROADCAST, &enabled, sizeof(enabled));

    sockaddr_in local{};
    local.sin_family = AF_INET;
    local.sin_port = htons(localPort);
    if (localIpAddress && std::strlen(localIpAddress) > 0 && std::strcmp(localIpAddress, "0.0.0.0") != 0) {
        if (inet_pton(AF_INET, localIpAddress, &local.sin_addr) != 1) {
            std::cerr << "[BACnet] Invalid local IP address: " << localIpAddress << std::endl;
            return false;
        }
    } else {
        local.sin_addr.s_addr = INADDR_ANY;
    }

    if (bind(socketFd.get(), reinterpret_cast<sockaddr *>(&local), sizeof(local)) != 0) {
        std::cerr << "[BACnet] Bind failed for " << (localIpAddress ? localIpAddress : "0.0.0.0")
                  << ":" << localPort << ": " << std::strerror(errno) << std::endl;
        return false;
    }

    context.socketFd = std::move(socketFd);
    context.port = localPort;
    return true;
}

} // namespace

bool bacnet_initialize(const char *localDeviceId, const char *localIpAddress, uint16_t localPort) {
    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.socketFd || context.simulatorEnabled) {
        return true;
    }

    context.simulatorEnabled = envEnabled("BACNET_SIMULATOR_ENABLED");
    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        std::cout << "[BACnet] Simulator enabled with " << simulatedDevices.size()
                  << " simulated BACnet devices. Real BACnet UDP is bypassed." << std::endl;
        return true;
    }

    std::cout << "[BACnet] Initializing BACnet/IP client: " << (localDeviceId ? localDeviceId : "EdgeCoreDevice")
              << " @ " << (localIpAddress ? localIpAddress : "0.0.0.0") << ":" << localPort << std::endl;
    if (!initializeSocket(localIpAddress, localPort)) {
        return false;
    }

    if (envEnabled("BEMS_FAIL_STARTUP_AFTER_SOCKET_OPEN")) {
        std::cerr << "[BACnet] Simulated startup failure after socket open." << std::endl;
        context.socketFd.reset();
        return false;
    }

    return true;
}

bool bacnet_discover_device(int deviceInstance, BacnetDeviceInfo *outInfo) {
    if (!outInfo || (!context.simulatorEnabled && !context.socketFd)) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        const auto device = simulatedDevices.find(deviceInstance);
        if (device == simulatedDevices.end()) {
            return false;
        }
        populateSimulatedInfo(device->second, outInfo);
        return true;
    }

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
    if (!outValue || (!context.simulatorEnabled && !context.socketFd)) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        const auto *device = findSimulatedPointLocked(deviceInstance, objectType, objectInstance);
        if (!device) {
            return false;
        }
        *outValue = device->presentValue;
        return true;
    }

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

bool bacnet_read_properties_multiple(const BacnetReadPropertyRequest *requests, size_t requestCount, BacnetReadPropertyResult *outResults) {
    if (!requests || !outResults || requestCount == 0 || (!context.simulatorEnabled && !context.socketFd)) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    for (size_t i = 0; i < requestCount; ++i) {
        outResults[i].deviceInstance = requests[i].deviceInstance;
        outResults[i].objectType = requests[i].objectType;
        outResults[i].objectInstance = requests[i].objectInstance;
        outResults[i].success = false;
        outResults[i].value = 0.0;
    }

    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        bool anySuccess = false;
        for (size_t i = 0; i < requestCount; ++i) {
            const auto *device = findSimulatedPointLocked(requests[i].deviceInstance, requests[i].objectType, requests[i].objectInstance);
            if (device) {
                outResults[i].success = true;
                outResults[i].value = device->presentValue;
                anySuccess = true;
            }
        }
        return anySuccess;
    }

    const int deviceInstance = requests[0].deviceInstance;
    for (size_t i = 1; i < requestCount; ++i) {
        if (requests[i].deviceInstance != deviceInstance) {
            return false;
        }
    }

    const auto address = discoverAddressLocked(deviceInstance, nullptr);
    if (!address) {
        return false;
    }

    const uint8_t invokeId = nextInvokeId();
    const auto packet = makeReadPropertyMultiple(invokeId, requests, requestCount);
    if (!sendPacket(packet, *address)) {
        std::cerr << "[BACnet] ReadPropertyMultiple send failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    for (int i = 0; i < 5; ++i) {
        auto received = receivePacket(1000);
        if (!received) {
            continue;
        }
        const auto values = parseReadPropertyMultipleAck(received->first, invokeId);
        if (values.empty()) {
            continue;
        }
        for (size_t j = 0; j < requestCount && j < values.size(); ++j) {
            outResults[j].success = true;
            outResults[j].value = values[j];
        }
        return true;
    }

    std::cerr << "[BACnet] ReadPropertyMultiple timed out for device=" << deviceInstance
              << " pointCount=" << requestCount << std::endl;
    return false;
}

bool bacnet_write_property(int deviceInstance, int objectType, int objectInstance, double value) {
    if (!context.simulatorEnabled && !context.socketFd) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        auto *device = findSimulatedPointLocked(deviceInstance, objectType, objectInstance);
        if (!device) {
            return false;
        }
        device->presentValue = value;
        device->status = "simulated";
        for (const auto &subscription : simulatedCovSubscriptions) {
            if (subscription.deviceInstance == deviceInstance &&
                subscription.objectType == objectType &&
                subscription.objectInstance == objectInstance) {
                simulatedCovNotifications.push_back({deviceInstance, objectType, objectInstance, value, subscription.subscriberProcessId, subscription.confirmedNotifications});
            }
        }
        return true;
    }

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

bool bacnet_subscribe_cov(int deviceInstance,
                          int objectType,
                          int objectInstance,
                          uint32_t subscriberProcessId,
                          uint32_t lifetimeSeconds,
                          bool confirmedNotifications) {
    if (!context.simulatorEnabled && !context.socketFd) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        if (!findSimulatedPointLocked(deviceInstance, objectType, objectInstance)) {
            return false;
        }
        simulatedCovSubscriptions.push_back({
            deviceInstance,
            objectType,
            objectInstance,
            subscriberProcessId == 0 ? 1 : subscriberProcessId,
            confirmedNotifications,
        });
        return true;
    }

    const auto address = discoverAddressLocked(deviceInstance, nullptr);
    if (!address) {
        return false;
    }

    const uint8_t invokeId = nextInvokeId();
    const auto packet = makeSubscribeCov(
        invokeId,
        objectType,
        objectInstance,
        subscriberProcessId == 0 ? 1 : subscriberProcessId,
        lifetimeSeconds == 0 ? 300 : lifetimeSeconds,
        confirmedNotifications);

    if (!sendPacket(packet, *address)) {
        std::cerr << "[BACnet] SubscribeCOV send failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    for (int i = 0; i < 5; ++i) {
        auto received = receivePacket(1000);
        if (!received) {
            continue;
        }
        if (parseSimpleAck(received->first, invokeId, SERVICE_SUBSCRIBE_COV)) {
            return true;
        }
    }

    std::cerr << "[BACnet] SubscribeCOV timed out for device=" << deviceInstance
              << " objectType=" << objectTypeName(objectType)
              << " objectInstance=" << objectInstance << std::endl;
    return false;
}

bool bacnet_poll_cov_notification(BacnetCovNotification *outNotification, int timeoutMs) {
    if (!outNotification || (!context.simulatorEnabled && !context.socketFd)) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.simulatorEnabled) {
        ensureSimulatedDevicesLocked();
        if (simulatedCovNotifications.empty()) {
            return false;
        }
        *outNotification = simulatedCovNotifications.front();
        simulatedCovNotifications.erase(simulatedCovNotifications.begin());
        return true;
    }

    auto received = receivePacket(timeoutMs > 0 ? timeoutMs : 1000);
    if (!received) {
        return false;
    }

    uint8_t invokeId = 0;
    auto notification = parseCovNotification(received->first, &invokeId);
    if (!notification) {
        return false;
    }

    char sourceIp[INET_ADDRSTRLEN] = {};
    inet_ntop(AF_INET, &received->second.sin_addr, sourceIp, sizeof(sourceIp));
    const auto matchingAddress = std::find_if(
        context.deviceAddresses.begin(),
        context.deviceAddresses.end(),
        [&received](const auto &entry) {
            return entry.second.sin_addr.s_addr == received->second.sin_addr.s_addr;
        }
    );
    if (matchingAddress != context.deviceAddresses.end()) {
        notification->deviceInstance = matchingAddress->first;
    }

    if (notification->confirmed) {
        const auto ack = makeSimpleAck(invokeId, SERVICE_CONFIRMED_COV_NOTIFICATION);
        sendPacket(ack, received->second);
    }

    *outNotification = *notification;
    return true;
}

size_t bacnet_server_object_count(void) {
    std::lock_guard<std::mutex> lock(context.mutex);
    return ensureServerObjectDatabaseLocked().objectCount();
}

bool bacnet_server_read_property_text(int objectType, int objectInstance, int propertyIdentifier, char *buffer, size_t bufferLength) {
    if (!buffer || bufferLength == 0) {
        return false;
    }

    std::lock_guard<std::mutex> lock(context.mutex);
    const auto text = ensureServerObjectDatabaseLocked().readPropertyText(
        {static_cast<BacnetObjectType>(objectType), objectInstance},
        static_cast<BacnetPropertyIdentifier>(propertyIdentifier));
    if (!text) {
        return false;
    }

    std::strncpy(buffer, text->c_str(), bufferLength - 1);
    buffer[bufferLength - 1] = '\0';
    return true;
}

bool bacnet_server_write_present_value(int objectType, int objectInstance, double value, int priority) {
    std::lock_guard<std::mutex> lock(context.mutex);
    return ensureServerObjectDatabaseLocked().writePresentValue(
        {static_cast<BacnetObjectType>(objectType), objectInstance}, value, priority);
}

bool bacnet_server_release_priority(int objectType, int objectInstance, int priority) {
    std::lock_guard<std::mutex> lock(context.mutex);
    return ensureServerObjectDatabaseLocked().releasePriority(
        {static_cast<BacnetObjectType>(objectType), objectInstance}, priority);
}

void bacnet_shutdown(void) {
    std::lock_guard<std::mutex> lock(context.mutex);
    if (context.socketFd) {
        context.socketFd.reset();
        context.deviceAddresses.clear();
        std::cout << "[BACnet] BACnet/IP client shut down" << std::endl;
    }
    context.simulatorEnabled = false;
    simulatedCovSubscriptions.clear();
    simulatedCovNotifications.clear();
    serverObjectDatabase.reset();
}
