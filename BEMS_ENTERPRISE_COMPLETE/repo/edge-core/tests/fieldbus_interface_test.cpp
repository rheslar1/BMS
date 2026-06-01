#include "canbus_interface.h"
#include "fieldbus_gateway.h"
#include "modbus_rtu_interface.h"

#include <cassert>

void testModbusCrcAndFrames() {
    const auto frame = modbus_build_read_holding_registers(0x01, 0x006B, 0x0003);
    assert(frame.size() == 8);
    assert(frame[0] == 0x01);
    assert(frame[1] == 0x03);
    assert(modbus_validate_response_crc(frame));

    const auto writeFrame = modbus_build_write_single_register(0x11, 0x0001, 0x0003);
    assert(writeFrame.size() == 8);
    assert(writeFrame[1] == 0x06);
    assert(modbus_validate_response_crc(writeFrame));
}

void testModbusSimulatorRegisters() {
    uint16_t value = 0;
    assert(modbus_simulator_read_register(1, 40001, &value));
    assert(value == 124);
    assert(!modbus_simulator_read_register(99, 40001, &value));
}

void testCanBusValidation() {
    CanBusFrame frame{};
    frame.arbitrationId = 0x123;
    frame.data = {0x01, 0x02, 0x03};
    std::string status;
    assert(canbus_validate_frame(frame, &status));
    assert(canbus_simulator_send(frame, &status));

    CanBusFrame invalid{};
    invalid.arbitrationId = 0x800;
    invalid.data = {0x01};
    assert(!canbus_validate_frame(invalid, &status));
}

void testFieldbusGatewayFacade() {
    SimulatorFieldbusGateway gateway;

    const auto readResult = gateway.readHoldingRegisters(1, 40001, 1);
    assert(readResult.accepted);
    assert(readResult.protocol == "Modbus RTU");
    assert(readResult.requestFrame.size() == 8);
    assert(readResult.registerValues.size() == 1);
    assert(readResult.registerValues[0] == 124);

    const auto writeResult = gateway.writeSingleRegister(1, 40002, 512);
    assert(writeResult.accepted);
    assert(writeResult.requestFrame.size() == 8);

    const auto mstpRead = gateway.readBacnetMstpPresentValue(12, 402, "binaryInput", 1);
    assert(mstpRead.accepted);
    assert(mstpRead.protocol == "BACnet MS/TP");
    assert(mstpRead.requestFrame.size() > 10);
    assert(mstpRead.requestFrame[0] == 0x55);
    assert(mstpRead.requestFrame[1] == 0xFF);

    const auto mstpWrite = gateway.writeBacnetMstpPresentValue(12, 102, "analogOutput", 1, 55.5);
    assert(mstpWrite.accepted);
    assert(mstpWrite.requestFrame.size() > mstpRead.requestFrame.size());

    CanBusFrame frame{};
    frame.arbitrationId = 0x321;
    frame.data = {0x0A, 0x0B};
    const auto canResult = gateway.sendCanFrame(frame);
    assert(canResult.accepted);
    assert(canResult.protocol == "CAN bus");
    assert(canResult.requestFrame.size() == 2);
}

int main() {
    testModbusCrcAndFrames();
    testModbusSimulatorRegisters();
    testCanBusValidation();
    testFieldbusGatewayFacade();
    return 0;
}
