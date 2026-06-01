#include "modbus_rtu_interface.h"

#include <map>
#include <utility>

namespace {

void appendCrc(std::vector<uint8_t> &frame) {
    const uint16_t crc = modbus_crc16(frame.data(), frame.size());
    frame.push_back(static_cast<uint8_t>(crc & 0xFF));
    frame.push_back(static_cast<uint8_t>((crc >> 8) & 0xFF));
}

} // namespace

uint16_t modbus_crc16(const uint8_t *data, std::size_t length) {
    uint16_t crc = 0xFFFF;
    for (std::size_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; ++bit) {
            if (crc & 0x0001) {
                crc = static_cast<uint16_t>((crc >> 1) ^ 0xA001);
            } else {
                crc = static_cast<uint16_t>(crc >> 1);
            }
        }
    }
    return crc;
}

std::vector<uint8_t> modbus_build_read_holding_registers(uint8_t slaveAddress,
                                                         uint16_t startRegister,
                                                         uint16_t quantity) {
    std::vector<uint8_t> frame = {
        slaveAddress,
        0x03,
        static_cast<uint8_t>((startRegister >> 8) & 0xFF),
        static_cast<uint8_t>(startRegister & 0xFF),
        static_cast<uint8_t>((quantity >> 8) & 0xFF),
        static_cast<uint8_t>(quantity & 0xFF),
    };
    appendCrc(frame);
    return frame;
}

std::vector<uint8_t> modbus_build_write_single_register(uint8_t slaveAddress,
                                                        uint16_t registerAddress,
                                                        uint16_t value) {
    std::vector<uint8_t> frame = {
        slaveAddress,
        0x06,
        static_cast<uint8_t>((registerAddress >> 8) & 0xFF),
        static_cast<uint8_t>(registerAddress & 0xFF),
        static_cast<uint8_t>((value >> 8) & 0xFF),
        static_cast<uint8_t>(value & 0xFF),
    };
    appendCrc(frame);
    return frame;
}

bool modbus_validate_response_crc(const std::vector<uint8_t> &frame) {
    if (frame.size() < 4) {
        return false;
    }
    const uint16_t expected = static_cast<uint16_t>(frame[frame.size() - 2]) |
                              static_cast<uint16_t>(frame[frame.size() - 1] << 8);
    const uint16_t actual = modbus_crc16(frame.data(), frame.size() - 2);
    return expected == actual;
}

bool modbus_simulator_read_register(uint8_t slaveAddress, uint16_t registerAddress, uint16_t *outValue) {
    if (!outValue) {
        return false;
    }

    static const std::map<std::pair<uint8_t, uint16_t>, uint16_t> registers = {
        {{1, 40001}, 124},
        {{1, 40002}, 482},
        {{2, 30001}, 221},
        {{3, 40010}, 60},
    };

    const auto found = registers.find({slaveAddress, registerAddress});
    if (found == registers.end()) {
        return false;
    }

    *outValue = found->second;
    return true;
}
