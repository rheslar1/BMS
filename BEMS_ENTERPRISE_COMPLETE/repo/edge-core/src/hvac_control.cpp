#include "hvac_control.h"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace {

double clampPercent(double value) {
    return std::clamp(value, 0.0, 100.0);
}

std::string normalizeType(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (value.find("ahu") != std::string::npos) return "ahu";
    if (value.find("vav") != std::string::npos) return "vav";
    if (value.find("chiller") != std::string::npos) return "chiller";
    return value;
}

} // namespace

PidController::PidController(PidGains gains) : gains_(gains) {}

double PidController::compute(double setpoint, double measuredValue, double deltaSeconds) {
    const double safeDelta = std::max(deltaSeconds, 1.0);
    const double error = setpoint - measuredValue;
    integral_ += error * safeDelta;
    const double derivative = initialized_ ? (error - previousError_) / safeDelta : 0.0;
    previousError_ = error;
    initialized_ = true;

    return std::clamp(
        gains_.proportional * error + gains_.integral * integral_ + gains_.derivative * derivative,
        gains_.minimumOutput,
        gains_.maximumOutput
    );
}

void PidController::reset() {
    integral_ = 0.0;
    previousError_ = 0.0;
    initialized_ = false;
}

AhuControlStrategy::AhuControlStrategy()
    : supplyAirPid_({8.0, 0.002, 0.05, 0.0, 100.0}) {}

HvacControlOutput AhuControlStrategy::evaluate(const HvacControlInput &input) {
    HvacControlOutput output;
    output.equipmentType = "AHU";
    if (!input.equipmentEnabled) {
        output.mode = "disabled";
        output.note = "AHU disabled by automation or maintenance mode.";
        return output;
    }

    const double setpointBias = input.demandResponseActive ? 1.0 : 0.0;
    const double adjustedSat = input.supplyAirSetpoint + setpointBias;
    output.valveCommand = clampPercent(supplyAirPid_.compute(input.supplyAirTemperature, adjustedSat, input.deltaSeconds));
    output.fanCommand = input.occupied ? 100.0 : 35.0;
    output.setpointBias = setpointBias;
    output.mode = input.demandResponseActive ? "demand_response_shed" : "occupied_supply_air_control";
    output.alarm = input.occupied && input.airflow < (input.airflowSetpoint * 0.45);
    output.note = output.alarm
        ? "AHU airflow is below expected occupied minimum."
        : "AHU fan and coil command calculated by supply-air PID loop.";
    return output;
}

VavControlStrategy::VavControlStrategy()
    : zonePid_({18.0, 0.004, 0.08, 0.0, 100.0}) {}

HvacControlOutput VavControlStrategy::evaluate(const HvacControlInput &input) {
    HvacControlOutput output;
    output.equipmentType = "VAV";
    if (!input.equipmentEnabled) {
        output.mode = "disabled";
        output.note = "VAV disabled by automation or maintenance mode.";
        return output;
    }

    const double setpointBias = input.demandResponseActive ? 1.0 : 0.0;
    const double adjustedSetpoint = input.zoneSetpoint + setpointBias;
    output.damperCommand = clampPercent(zonePid_.compute(input.zoneTemperature, adjustedSetpoint, input.deltaSeconds));
    output.fanCommand = output.damperCommand > 8.0 ? 100.0 : 0.0;
    output.setpointBias = setpointBias;
    output.mode = input.occupied ? "occupied_zone_temperature_control" : "standby_minimum_airflow";
    if (!input.occupied) {
        output.damperCommand = std::min(output.damperCommand, 25.0);
    }
    output.alarm = input.occupied && std::abs(input.zoneTemperature - adjustedSetpoint) > 3.0;
    output.note = output.alarm
        ? "Zone temperature is not tracking the commanded setpoint."
        : "VAV damper command calculated by zone temperature PID loop.";
    return output;
}

ChillerControlStrategy::ChillerControlStrategy()
    : chilledWaterPid_({22.0, 0.003, 0.08, 0.0, 100.0}) {}

HvacControlOutput ChillerControlStrategy::evaluate(const HvacControlInput &input) {
    HvacControlOutput output;
    output.equipmentType = "Chiller";
    if (!input.equipmentEnabled) {
        output.mode = "disabled";
        output.note = "Chiller disabled by automation or maintenance mode.";
        return output;
    }

    const double demandBias = input.demandResponseActive ? 1.0 : 0.0;
    const double adjustedSetpoint = input.chilledWaterSetpoint + demandBias;
    output.chillerCommand = clampPercent(chilledWaterPid_.compute(input.chilledWaterTemperature, adjustedSetpoint, input.deltaSeconds));
    output.setpointBias = demandBias;
    output.mode = input.demandResponseActive ? "demand_response_chilled_water_reset" : "chilled_water_pid_control";
    output.alarm = input.chilledWaterTemperature > adjustedSetpoint + 4.0;
    output.note = output.alarm
        ? "Chilled water temperature is above reset limit."
        : "Chiller command calculated by chilled-water PID loop.";
    return output;
}

HvacControlEngine::HvacControlEngine() {
    strategies_.emplace("ahu", std::make_unique<AhuControlStrategy>());
    strategies_.emplace("vav", std::make_unique<VavControlStrategy>());
    strategies_.emplace("chiller", std::make_unique<ChillerControlStrategy>());
}

HvacControlOutput HvacControlEngine::evaluate(const HvacControlInput &input) {
    const auto type = normalizeType(input.equipmentType);
    const auto strategy = strategies_.find(type);
    if (strategy == strategies_.end()) {
        return {
            input.equipmentType,
            "unsupported",
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            true,
            "No HVAC control strategy registered for equipment type."
        };
    }
    return strategy->second->evaluate(input);
}
