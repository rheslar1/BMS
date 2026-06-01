#include "fieldbus_gateway.h"

#include "modbus_rtu_interface.h"

#include <cmath>
#include <sstream>

namespace {

bool invalidModbusRange(uint8_t slaveAddress, uint16_t quantity, std::string *message) {
    if (slaveAddress == 0) {
        if (message) {
            *message = "Modbus RTU slave address must be non-zero";
        }
        return true;
    }
    if (quantity == 0 || quantity > 125) {
        if (message) {
            *message = "Modbus RTU read quantity must be between 1 and 125 registers";
        }
        return true;
    }
    return false;
}

uint8_t bacnetMstpHeaderCrc(const std::vector<uint8_t> &bytes) {
    uint8_t crc = 0xFF;
    for (const auto byte : bytes) {
        crc ^= byte;
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x01) ? static_cast<uint8_t>((crc >> 1) ^ 0x8C) : static_cast<uint8_t>(crc >> 1);
        }
    }
    return static_cast<uint8_t>(~crc);
}

uint16_t bacnetMstpDataCrc(const std::vector<uint8_t> &bytes) {
    uint16_t crc = 0xFFFF;
    for (const auto byte : bytes) {
        crc ^= byte;
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x0001) ? static_cast<uint16_t>((crc >> 1) ^ 0xA001) : static_cast<uint16_t>(crc >> 1);
        }
    }
    return static_cast<uint16_t>(~crc);
}

uint16_t bacnetObjectTypeCode(const std::string &objectType) {
    if (objectType == "analogInput") return 0;
    if (objectType == "analogOutput") return 1;
    if (objectType == "analogValue") return 2;
    if (objectType == "binaryInput") return 3;
    if (objectType == "binaryOutput") return 4;
    if (objectType == "binaryValue") return 5;
    if (objectType == "schedule") return 17;
    return 8;
}

std::vector<uint8_t> buildBacnetMstpFrame(uint8_t frameType,
                                          uint8_t destination,
                                          uint8_t source,
                                          const std::vector<uint8_t> &payload) {
    std::vector<uint8_t> frame{0x55, 0xFF, frameType, destination, source,
                               static_cast<uint8_t>((payload.size() >> 8) & 0xFF),
                               static_cast<uint8_t>(payload.size() & 0xFF)};
    std::vector<uint8_t> header{frame.begin() + 2, frame.end()};
    frame.push_back(bacnetMstpHeaderCrc(header));
    frame.insert(frame.end(), payload.begin(), payload.end());
    const auto dataCrc = bacnetMstpDataCrc(payload);
    frame.push_back(static_cast<uint8_t>(dataCrc & 0xFF));
    frame.push_back(static_cast<uint8_t>((dataCrc >> 8) & 0xFF));
    return frame;
}

std::vector<uint8_t> buildBacnetApplicationPayload(uint8_t serviceChoice,
                                                   uint32_t deviceInstance,
                                                   const std::string &objectType,
                                                   uint32_t objectInstance,
                                                   double value = NAN) {
    std::vector<uint8_t> payload{
        0x01, 0x04, serviceChoice,
        static_cast<uint8_t>((deviceInstance >> 16) & 0xFF),
        static_cast<uint8_t>((deviceInstance >> 8) & 0xFF),
        static_cast<uint8_t>(deviceInstance & 0xFF),
        static_cast<uint8_t>((bacnetObjectTypeCode(objectType) >> 8) & 0xFF),
        static_cast<uint8_t>(bacnetObjectTypeCode(objectType) & 0xFF),
        static_cast<uint8_t>((objectInstance >> 16) & 0xFF),
        static_cast<uint8_t>((objectInstance >> 8) & 0xFF),
        static_cast<uint8_t>(objectInstance & 0xFF),
        0x55,
    };
    if (!std::isnan(value)) {
        const auto scaled = static_cast<int32_t>(std::round(value * 100.0));
        payload.push_back(static_cast<uint8_t>((scaled >> 24) & 0xFF));
        payload.push_back(static_cast<uint8_t>((scaled >> 16) & 0xFF));
        payload.push_back(static_cast<uint8_t>((scaled >> 8) & 0xFF));
        payload.push_back(static_cast<uint8_t>(scaled & 0xFF));
    }
    return payload;
}

} // namespace

FieldbusCommandResult SimulatorFieldbusGateway::readHoldingRegisters(uint8_t slaveAddress,
                                                                     uint16_t startRegister,
                                                                     uint16_t quantity) {
    FieldbusCommandResult result;
    result.protocol = "Modbus RTU";

    if (invalidModbusRange(slaveAddress, quantity, &result.message)) {
        return result;
    }

    result.requestFrame = modbus_build_read_holding_registers(slaveAddress, startRegister, quantity);
    result.accepted = true;

    if (quantity == 1) {
        uint16_t value = 0;
        if (modbus_simulator_read_register(slaveAddress, startRegister, &value)) {
            result.registerValues.push_back(value);
            result.message = "Modbus RTU simulator returned one holding-register value";
            return result;
        }
    }

    result.message = "Modbus RTU request frame generated";
    return result;
}

FieldbusCommandResult SimulatorFieldbusGateway::writeSingleRegister(uint8_t slaveAddress,
                                                                    uint16_t registerAddress,
                                                                    uint16_t value) {
    FieldbusCommandResult result;
    result.protocol = "Modbus RTU";

    if (slaveAddress == 0) {
        result.message = "Modbus RTU slave address must be non-zero";
        return result;
    }

    result.requestFrame = modbus_build_write_single_register(slaveAddress, registerAddress, value);
    result.accepted = true;
    result.message = "Modbus RTU write-single-register request frame generated";
    return result;
}

FieldbusCommandResult SimulatorFieldbusGateway::readBacnetMstpPresentValue(uint8_t macAddress,
                                                                           uint32_t deviceInstance,
                                                                           const std::string &objectType,
                                                                           uint32_t objectInstance) {
    FieldbusCommandResult result;
    result.protocol = "BACnet MS/TP";
    if (macAddress == 0 || macAddress == 255) {
        result.message = "BACnet MS/TP MAC address must be 1-254";
        return result;
    }
    const auto payload = buildBacnetApplicationPayload(0x0C, deviceInstance, objectType, objectInstance);
    result.requestFrame = buildBacnetMstpFrame(0x05, macAddress, 0x01, payload);
    result.accepted = true;
    result.message = "BACnet MS/TP ReadProperty present-value frame generated for EIA-485 adapter";
    return result;
}

FieldbusCommandResult SimulatorFieldbusGateway::writeBacnetMstpPresentValue(uint8_t macAddress,
                                                                            uint32_t deviceInstance,
                                                                            const std::string &objectType,
                                                                            uint32_t objectInstance,
                                                                            double value) {
    FieldbusCommandResult result;
    result.protocol = "BACnet MS/TP";
    if (macAddress == 0 || macAddress == 255) {
        result.message = "BACnet MS/TP MAC address must be 1-254";
        return result;
    }
    const auto payload = buildBacnetApplicationPayload(0x0F, deviceInstance, objectType, objectInstance, value);
    result.requestFrame = buildBacnetMstpFrame(0x05, macAddress, 0x01, payload);
    result.accepted = true;
    result.message = "BACnet MS/TP WriteProperty present-value frame generated for EIA-485 adapter";
    return result;
}

FieldbusCommandResult SimulatorFieldbusGateway::sendCanFrame(const CanBusFrame &frame) {
    FieldbusCommandResult result;
    result.protocol = "CAN bus";
    std::string status;
    result.accepted = canbus_simulator_send(frame, &status);
    result.message = status;
    if (result.accepted) {
        result.requestFrame = frame.data;
    }
    return result;
}
