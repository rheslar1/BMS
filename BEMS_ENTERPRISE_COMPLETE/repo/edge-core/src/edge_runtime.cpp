#include "edge_runtime.h"
#include <iostream>
#include <utility>

namespace {

int bacnetObjectTypeCode(const std::string &objectType) {
    if (objectType == "analogInput") return 0;
    if (objectType == "analogOutput") return 1;
    if (objectType == "analogValue") return 2;
    if (objectType == "binaryInput") return 3;
    if (objectType == "binaryOutput") return 4;
    if (objectType == "binaryValue") return 5;
    if (objectType == "device") return 8;
    if (objectType == "schedule") return 17;
    return 1;
}

} // namespace

EdgeRuntime::EdgeRuntime(DeviceManager deviceManager,
                         EnergyAI energyAI,
                         std::unique_ptr<IDeviceDiscovery> discovery,
                         std::unique_ptr<IWritebackController> writeback)
    : deviceManager_(std::move(deviceManager)),
      energyAI_(std::move(energyAI)),
      discovery_(std::move(discovery)),
      writeback_(std::move(writeback)) {}

bool EdgeRuntime::initialize() {
    std::lock_guard<std::mutex> lock(mutex_);
    return deviceManager_.initialize() && energyAI_.initialize();
}

void EdgeRuntime::printStartupSummary() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::cout << "BACnet C Stack Edge Core initialized with Energy AI." << std::endl;

    for (const auto &device : deviceManager_.getDevices()) {
        std::cout << "Device " << device.id << ": " << device.name << " (" << device.type << ")\n"
                  << "  Vendor: " << device.vendor << "\n"
                  << "  Model: " << device.model << "\n"
                  << "  BACnet Instance: " << device.bacnetInstance << "\n"
                  << "  Object Type: " << device.objectType << "\n"
                  << "  Object Instance: " << device.objectInstance << "\n"
                  << "  IP Address: " << device.ipAddress << "\n"
                  << "  Present Value: " << device.presentValue << " " << device.units << "\n"
                  << "  Status: " << device.status << "\n";
    }

    const auto forecast = energyAI_.forecastHourly(6);
    std::cout << "Energy AI forecast (next 6 hours):" << std::endl;
    for (const auto &entry : forecast) {
        std::cout << "  " << entry.interval << ": " << entry.predictedKwh << " kWh, $" << entry.estimatedCost
                  << " - " << entry.recommendation << "\n";
    }
}

void EdgeRuntime::pollOnce() {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto &device : deviceManager_.getDevices()) {
        if (deviceManager_.refreshDevice(device)) {
            std::cout << "Refreshed device " << device.id << ": " << device.presentValue << " " << device.units << "\n";
        }
    }

    std::cout << "Predicted daily energy usage: " << energyAI_.predictedDailyUsage() << " kWh" << std::endl;
    std::cout << energyAI_.optimizeSetpoint(22.5, 23.8) << std::endl;
}

WritebackResult EdgeRuntime::writeSetpoint(const DeviceDetails &device, double setpoint, double minimum, double maximum) {
    std::lock_guard<std::mutex> lock(mutex_);
    return writeback_->write({
        {device.bacnetInstance, bacnetObjectTypeCode(device.objectType), device.objectInstance},
        setpoint,
        minimum,
        maximum,
        WriteMode::Absolute,
    });
}

std::vector<DeviceDetails> EdgeRuntime::listDevices() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return deviceManager_.getDevices();
}

std::vector<DeviceDetails> EdgeRuntime::discoverDevices(int lowInstance, int highInstance) {
    std::lock_guard<std::mutex> lock(mutex_);
    return discovery_->discover(lowInstance, highInstance);
}

bool EdgeRuntime::readPoint(int deviceInstance, int objectType, int objectInstance, double &outValue) {
    std::lock_guard<std::mutex> lock(mutex_);
    return deviceManager_.readPoint(deviceInstance, objectType, objectInstance, outValue);
}

WritebackResult EdgeRuntime::writePoint(int deviceInstance, int objectType, int objectInstance, double value, WriteMode mode) {
    std::lock_guard<std::mutex> lock(mutex_);
    return writeback_->write({
        {deviceInstance, objectType, objectInstance},
        value,
        -1000000.0,
        1000000.0,
        mode,
    });
}

std::vector<EnergyPrediction> EdgeRuntime::getEnergyForecast(int hours) const {
    return energyAI_.forecastHourly(hours);
}
