#include "edge_runtime.h"
#include "logger.h"
#include <algorithm>
#include <sstream>
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

EdgeRuntime::~EdgeRuntime() {
    stopPolling();
}

bool EdgeRuntime::initialize() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!discovery_ || !writeback_) {
        setError(EdgeRuntimeError::MissingDependency, "runtime dependencies were not provided");
        Logger::error(lastErrorMessage_);
        return false;
    }

    if (!deviceManager_.initialize()) {
        setError(EdgeRuntimeError::BacnetInitializationFailed, "failed to initialize BACnet stack");
        Logger::error(lastErrorMessage_);
        return false;
    }

    if (!energyAI_.initialize()) {
        setError(EdgeRuntimeError::EnergyAiInitializationFailed, "failed to initialize Energy AI");
        Logger::error(lastErrorMessage_);
        return false;
    }

    setError(EdgeRuntimeError::None, {});
    Logger::info("runtime initialized");
    return true;
}

bool EdgeRuntime::startPolling(std::chrono::milliseconds interval, WorkerCallback callback) {
    bool expected = false;
    if (!pollingEnabled_.compare_exchange_strong(expected, true)) {
        std::lock_guard<std::mutex> lock(mutex_);
        setError(EdgeRuntimeError::PollerAlreadyRunning, "polling loop is already running");
        Logger::warning(lastErrorMessage_);
        return false;
    }

    pollingThread_ = std::thread([this, interval, callback = std::move(callback)]() {
        pollingLoop(interval, callback);
    });
    Logger::info("background polling loop started");
    return true;
}

void EdgeRuntime::stopPolling() {
    if (!pollingEnabled_.exchange(false)) {
        return;
    }

    pollingCondition_.notify_all();
    if (pollingThread_.joinable()) {
        pollingThread_.join();
    }
    Logger::info("background polling loop stopped");
}

void EdgeRuntime::printStartupSummary() const {
    std::lock_guard<std::mutex> lock(mutex_);
    Logger::info("BACnet C Stack Edge Core initialized with Energy AI");

    for (const auto &device : deviceManager_.getDevices()) {
        std::ostringstream message;
        message << "device=" << device.id
                << " name=\"" << device.name << "\""
                << " type=\"" << device.type << "\""
                << " vendor=\"" << device.vendor << "\""
                << " model=\"" << device.model << "\""
                << " bacnetInstance=" << device.bacnetInstance
                << " objectType=" << device.objectType
                << " objectInstance=" << device.objectInstance
                << " ip=" << device.ipAddress
                << " presentValue=" << device.presentValue << " " << device.units
                << " status=" << device.status;
        Logger::info(message.str());
    }

    const auto forecast = energyAI_.forecastHourly(6);
    for (const auto &entry : forecast) {
        std::ostringstream message;
        message << "forecast interval=" << entry.interval
                << " predictedKwh=" << entry.predictedKwh
                << " estimatedCost=" << entry.estimatedCost
                << " recommendation=\"" << entry.recommendation << "\"";
        Logger::info(message.str());
    }
}

void EdgeRuntime::pollOnce() {
    std::vector<DeviceDetails> telemetryBatch;
    double predictedDailyUsage = 0.0;
    std::string setpointRecommendation;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto deviceCount = deviceManager_.getDevices().size();
        telemetryBatch.reserve(std::min(deviceCount, MaxTelemetryBatchSize));

        for (auto &device : deviceManager_.getDevices()) {
            if (deviceManager_.refreshDevice(device)) {
                if (telemetryBatch.size() < MaxTelemetryBatchSize) {
                    telemetryBatch.push_back(device);
                }
            }
        }

        predictedDailyUsage = energyAI_.predictedDailyUsage();
        setpointRecommendation = energyAI_.optimizeSetpoint(22.5, 23.8);
    }

    std::sort(telemetryBatch.begin(), telemetryBatch.end(), [](const DeviceDetails &left, const DeviceDetails &right) {
        return left.id < right.id;
    });

    for (const auto &device : telemetryBatch) {
        std::ostringstream message;
        message << "refreshed device=" << device.id << " presentValue=" << device.presentValue << " " << device.units;
        Logger::info(message.str());
    }

    std::ostringstream energyMessage;
    energyMessage << "predictedDailyUsageKwh=" << predictedDailyUsage;
    Logger::info(energyMessage.str());
    Logger::info(setpointRecommendation);
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
    std::lock_guard<std::mutex> lock(mutex_);
    return energyAI_.forecastHourly(hours);
}

EdgeRuntimeError EdgeRuntime::lastError() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return lastError_;
}

std::string EdgeRuntime::lastErrorMessage() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return lastErrorMessage_;
}

void EdgeRuntime::setError(EdgeRuntimeError error, std::string message) {
    lastError_ = error;
    lastErrorMessage_ = std::move(message);
}

void EdgeRuntime::pollingLoop(std::chrono::milliseconds interval, const WorkerCallback &callback) {
    while (pollingEnabled_.load()) {
        pollOnce();
        if (callback) {
            callback();
        }
        std::unique_lock<std::mutex> lock(pollingMutex_);
        pollingCondition_.wait_for(lock, interval, [this]() {
            return !pollingEnabled_.load();
        });
    }
}
