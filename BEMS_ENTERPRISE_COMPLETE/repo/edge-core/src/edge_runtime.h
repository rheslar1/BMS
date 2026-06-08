#pragma once

#include "device_manager.h"
#include "discovery_service.h"
#include "energy_ai.h"
#include "writeback_controller.h"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

enum class EdgeRuntimeError {
    None,
    BacnetInitializationFailed,
    EnergyAiInitializationFailed,
    PollerAlreadyRunning,
    MissingDependency,
};

class EdgeRuntime {
public:
    using WorkerCallback = std::function<void()>;
    static constexpr std::size_t MaxTelemetryBatchSize = 256;

    EdgeRuntime(DeviceManager deviceManager,
                EnergyAI energyAI,
                std::unique_ptr<IDeviceDiscovery> discovery,
                std::unique_ptr<IWritebackController> writeback);
    ~EdgeRuntime();

    EdgeRuntime(const EdgeRuntime &) = delete;
    EdgeRuntime &operator=(const EdgeRuntime &) = delete;
    EdgeRuntime(EdgeRuntime &&) = delete;
    EdgeRuntime &operator=(EdgeRuntime &&) = delete;

    bool initialize();
    bool startPolling(std::chrono::milliseconds interval, WorkerCallback callback = {});
    void stopPolling();
    void printStartupSummary() const;
    void pollOnce();
    WritebackResult writeSetpoint(const DeviceDetails &device, double setpoint, double minimum, double maximum);
    std::vector<DeviceDetails> listDevices() const;
    std::vector<DeviceDetails> discoverDevices(int lowInstance, int highInstance);
    bool readPoint(int deviceInstance, int objectType, int objectInstance, double &outValue);
    WritebackResult writePoint(int deviceInstance, int objectType, int objectInstance, double value, WriteMode mode);
    std::vector<EnergyPrediction> getEnergyForecast(int hours) const;
    EdgeRuntimeError lastError() const;
    std::string lastErrorMessage() const;

private:
    void setError(EdgeRuntimeError error, std::string message);
    void pollingLoop(std::chrono::milliseconds interval, const WorkerCallback &callback);

    DeviceManager deviceManager_;
    EnergyAI energyAI_;
    std::unique_ptr<IDeviceDiscovery> discovery_;
    std::unique_ptr<IWritebackController> writeback_;
    mutable std::mutex mutex_;
    std::thread pollingThread_;
    std::condition_variable pollingCondition_;
    std::mutex pollingMutex_;
    std::atomic_bool pollingEnabled_{false};
    EdgeRuntimeError lastError_{EdgeRuntimeError::None};
    std::string lastErrorMessage_;
};
