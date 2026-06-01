#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct CanBusFrame {
    uint32_t arbitrationId{0};
    bool extended{false};
    std::vector<uint8_t> data;
};

bool canbus_validate_frame(const CanBusFrame &frame, std::string *errorMessage);
bool canbus_simulator_send(const CanBusFrame &frame, std::string *statusMessage);
