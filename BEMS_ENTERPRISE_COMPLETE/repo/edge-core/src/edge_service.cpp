#include "edge_service.h"

#include "bacnet_client.h"
#include "discovery_service.h"
#include "edge_runtime.h"
#include "energy_ai.h"
#include "logger.h"
#include "writeback_controller.h"

#include <utility>

class EdgeService::Impl {
public:
    Impl(EdgeServiceConfig config, std::shared_ptr<IBacnetClient> bacnetClient)
        : config_(std::move(config)),
          bacnetClient_(bacnetClient ? std::move(bacnetClient) : createDefaultBacnetClient()),
          runtime_(DeviceManager(config_.localAddress, config_.localPort, bacnetClient_),
                   EnergyAI{},
                   std::make_unique<BacnetDeviceDiscovery>(bacnetClient_),
                   std::make_unique<SafeWritebackController>(bacnetClient_)) {}

    bool start() {
        if (!runtime_.initialize()) {
            Logger::error("edge service startup failed: " + runtime_.lastErrorMessage());
            return false;
        }

        runtime_.printStartupSummary();

        if (config_.pollingEnabled && !runtime_.startPolling(config_.pollingInterval)) {
            Logger::error("edge service failed to start worker thread: " + runtime_.lastErrorMessage());
            return false;
        }

        running_ = true;
        Logger::info("edge service started");
        return true;
    }

    bool startPolling(std::chrono::milliseconds interval, WorkerCallback callback) {
        return runtime_.startPolling(interval, std::move(callback));
    }

    void stop() {
        if (!running_) {
            return;
        }

        runtime_.stopPolling();
        running_ = false;
        Logger::info("edge service stopped");
    }

    bool running() const noexcept { return running_; }

private:
    EdgeServiceConfig config_;
    std::shared_ptr<IBacnetClient> bacnetClient_;
    EdgeRuntime runtime_;
    bool running_{false};
};

EdgeServiceConfig makeDefaultEdgeServiceConfig(std::string localAddress,
                                               unsigned short localPort,
                                               bool pollingEnabled,
                                               std::chrono::milliseconds pollingInterval) {
    EdgeServiceConfig config;
    config.localAddress = std::move(localAddress);
    config.localPort = localPort;
    config.pollingEnabled = pollingEnabled;
    config.pollingInterval = pollingInterval;
    config.telemetryPoints = {
        {1, "lobby-temperature", "Celsius", 16.0, 28.0},
        {1, "vav-damper-command", "Percent", 0.0, 100.0},
        {1, "fan-enable", "On/Off", 0.0, 1.0},
        {1, "occupancy-schedule", "Schedule", 0.0, 1.0},
    };
    return config;
}

EdgeService::EdgeService(EdgeServiceConfig config, std::shared_ptr<IBacnetClient> bacnetClient)
    : impl_(std::make_unique<Impl>(std::move(config), std::move(bacnetClient))) {}

EdgeService::~EdgeService() {
    stop();
}

EdgeService::EdgeService(EdgeService &&) noexcept = default;

EdgeService &EdgeService::operator=(EdgeService &&) noexcept = default;

bool EdgeService::start() {
    return impl_->start();
}

bool EdgeService::startPolling(std::chrono::milliseconds interval, WorkerCallback callback) {
    return impl_->startPolling(interval, std::move(callback));
}

void EdgeService::stop() {
    impl_->stop();
}

bool EdgeService::running() const noexcept {
    return impl_->running();
}
