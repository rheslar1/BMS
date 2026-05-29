#pragma once

#include "device_manager.h"
#include "discovery_service.h"
#include "energy_ai.h"
#include "writeback_controller.h"
#include <memory>

class EdgeRuntime {
public:
    EdgeRuntime(DeviceManager deviceManager,
                EnergyAI energyAI,
                std::unique_ptr<IDeviceDiscovery> discovery,
                std::unique_ptr<IWritebackController> writeback);

    bool initialize();
    void printStartupSummary() const;
    void pollOnce();
    WritebackResult writeSetpoint(const DeviceDetails &device, double setpoint, double minimum, double maximum);

private:
    DeviceManager deviceManager_;
    EnergyAI energyAI_;
    std::unique_ptr<IDeviceDiscovery> discovery_;
    std::unique_ptr<IWritebackController> writeback_;
};
