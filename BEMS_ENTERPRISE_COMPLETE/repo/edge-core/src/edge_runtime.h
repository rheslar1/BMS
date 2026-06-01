#pragma once

#include "device_manager.h"
#include "discovery_service.h"
#include "energy_ai.h"
#include "writeback_controller.h"
#include <memory>
#include <mutex>
#include <vector>

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
    std::vector<DeviceDetails> listDevices() const;
    std::vector<DeviceDetails> discoverDevices(int lowInstance, int highInstance);
    bool readPoint(int deviceInstance, int objectType, int objectInstance, double &outValue);
    WritebackResult writePoint(int deviceInstance, int objectType, int objectInstance, double value, WriteMode mode);
    std::vector<EnergyPrediction> getEnergyForecast(int hours) const;

private:
    DeviceManager deviceManager_;
    EnergyAI energyAI_;
    std::unique_ptr<IDeviceDiscovery> discovery_;
    std::unique_ptr<IWritebackController> writeback_;
    mutable std::mutex mutex_;
};
