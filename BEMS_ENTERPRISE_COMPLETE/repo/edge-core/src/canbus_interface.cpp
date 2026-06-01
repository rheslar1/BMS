#include "canbus_interface.h"

bool canbus_validate_frame(const CanBusFrame &frame, std::string *errorMessage) {
    const uint32_t maxId = frame.extended ? 0x1FFFFFFF : 0x7FF;
    if (frame.arbitrationId > maxId) {
        if (errorMessage) {
            *errorMessage = frame.extended ? "extended CAN identifier exceeds 29 bits" : "standard CAN identifier exceeds 11 bits";
        }
        return false;
    }

    if (frame.data.size() > 8) {
        if (errorMessage) {
            *errorMessage = "classic CAN frame payload exceeds 8 bytes";
        }
        return false;
    }

    if (errorMessage) {
        *errorMessage = "valid";
    }
    return true;
}

bool canbus_simulator_send(const CanBusFrame &frame, std::string *statusMessage) {
    std::string validation;
    if (!canbus_validate_frame(frame, &validation)) {
        if (statusMessage) {
            *statusMessage = validation;
        }
        return false;
    }

    if (statusMessage) {
        *statusMessage = "CAN frame accepted by simulator";
    }
    return true;
}
