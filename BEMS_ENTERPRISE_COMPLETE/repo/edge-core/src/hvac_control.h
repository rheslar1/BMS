#pragma once

#include <memory>
#include <string>
#include <unordered_map>

struct PidGains {
    double proportional = 1.0;
    double integral = 0.0;
    double derivative = 0.0;
    double minimumOutput = 0.0;
    double maximumOutput = 100.0;
};

class PidController {
public:
    explicit PidController(const PidGains &gains);
    double compute(double setpoint, double measuredValue, double deltaSeconds);
    void reset();

private:
    PidGains gains_;
    double integral_ = 0.0;
    double previousError_ = 0.0;
    bool initialized_ = false;
};

struct HvacControlInput {
    std::string equipmentType;
    std::string equipmentName;
    double zoneTemperature = 22.0;
    double zoneSetpoint = 22.0;
    double supplyAirTemperature = 13.0;
    double supplyAirSetpoint = 13.0;
    double airflow = 0.0;
    double airflowSetpoint = 55.0;
    double chilledWaterTemperature = 7.0;
    double chilledWaterSetpoint = 7.0;
    bool occupied = true;
    bool demandResponseActive = false;
    bool equipmentEnabled = true;
    double deltaSeconds = 60.0;
};

struct HvacControlOutput {
    std::string equipmentType;
    std::string mode;
    double fanCommand = 0.0;
    double valveCommand = 0.0;
    double damperCommand = 0.0;
    double chillerCommand = 0.0;
    double setpointBias = 0.0;
    bool alarm = false;
    std::string note;
};

class IHvacControlStrategy {
public:
    virtual ~IHvacControlStrategy() = default;
    virtual HvacControlOutput evaluate(const HvacControlInput &input) = 0;
};

class AhuControlStrategy final : public IHvacControlStrategy {
public:
    AhuControlStrategy();
    HvacControlOutput evaluate(const HvacControlInput &input) override;

private:
    PidController supplyAirPid_;
};

class VavControlStrategy final : public IHvacControlStrategy {
public:
    VavControlStrategy();
    HvacControlOutput evaluate(const HvacControlInput &input) override;

private:
    PidController zonePid_;
};

class ChillerControlStrategy final : public IHvacControlStrategy {
public:
    ChillerControlStrategy();
    HvacControlOutput evaluate(const HvacControlInput &input) override;

private:
    PidController chilledWaterPid_;
};

class HvacControlEngine {
public:
    HvacControlEngine();
    HvacControlOutput evaluate(const HvacControlInput &input);

private:
    std::unordered_map<std::string, std::unique_ptr<IHvacControlStrategy>> strategies_;
};
