#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

uint16_t modbus_crc16(const uint8_t *data, std::size_t length);
std::vector<uint8_t> modbus_build_read_holding_registers(uint8_t slaveAddress,
                                                         uint16_t startRegister,
                                                         uint16_t quantity);
std::vector<uint8_t> modbus_build_write_single_register(uint8_t slaveAddress,
                                                        uint16_t registerAddress,
                                                        uint16_t value);
bool modbus_validate_response_crc(const std::vector<uint8_t> &frame);
bool modbus_simulator_read_register(uint8_t slaveAddress, uint16_t registerAddress, uint16_t *outValue);
