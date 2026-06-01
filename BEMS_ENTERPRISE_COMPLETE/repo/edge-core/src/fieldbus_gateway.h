#pragma once

#include "canbus_interface.h"

#include <cstdint>
#include <string>
#include <vector>

struct FieldbusCommandResult {
    bool accepted{false};
    std::string protocol;
    std::vector<uint8_t> requestFrame;
    std::vector<uint16_t> registerValues;
    std::string message;
};

class IFieldbusGateway {
public:
    virtual ~IFieldbusGateway() = default;

    virtual FieldbusCommandResult readHoldingRegisters(uint8_t slaveAddress,
                                                       uint16_t startRegister,
                                                       uint16_t quantity) = 0;
    virtual FieldbusCommandResult writeSingleRegister(uint8_t slaveAddress,
                                                      uint16_t registerAddress,
                                                      uint16_t value) = 0;
    virtual FieldbusCommandResult readBacnetMstpPresentValue(uint8_t macAddress,
                                                             uint32_t deviceInstance,
                                                             const std::string &objectType,
                                                             uint32_t objectInstance) = 0;
    virtual FieldbusCommandResult writeBacnetMstpPresentValue(uint8_t macAddress,
                                                              uint32_t deviceInstance,
                                                              const std::string &objectType,
                                                              uint32_t objectInstance,
                                                              double value) = 0;
    virtual FieldbusCommandResult sendCanFrame(const CanBusFrame &frame) = 0;
};

class SimulatorFieldbusGateway final : public IFieldbusGateway {
public:
    FieldbusCommandResult readHoldingRegisters(uint8_t slaveAddress,
                                               uint16_t startRegister,
                                               uint16_t quantity) override;
    FieldbusCommandResult writeSingleRegister(uint8_t slaveAddress,
                                              uint16_t registerAddress,
                                              uint16_t value) override;
    FieldbusCommandResult readBacnetMstpPresentValue(uint8_t macAddress,
                                                     uint32_t deviceInstance,
                                                     const std::string &objectType,
                                                     uint32_t objectInstance) override;
    FieldbusCommandResult writeBacnetMstpPresentValue(uint8_t macAddress,
                                                      uint32_t deviceInstance,
                                                      const std::string &objectType,
                                                      uint32_t objectInstance,
                                                      double value) override;
    FieldbusCommandResult sendCanFrame(const CanBusFrame &frame) override;
};
