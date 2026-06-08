#pragma once

#include "edge_core_export.h"

#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <vector>

class IBacnetClient;

struct TelemetryPointConfig {
    unsigned int schemaVersion{1};
    std::string name;
    std::string units;
    double warningLow{0.0};
    double warningHigh{0.0};
};

struct EdgeServiceConfig {
    unsigned int schemaVersion{1};
    std::string localAddress{"0.0.0.0"};
    unsigned short localPort{47808};
    bool pollingEnabled{false};
    std::chrono::milliseconds pollingInterval{std::chrono::seconds(10)};
    std::vector<TelemetryPointConfig> telemetryPoints;
};

BEMS_EDGE_CORE_EXPORT EdgeServiceConfig makeDefaultEdgeServiceConfig(std::string localAddress,
                                                                    unsigned short localPort,
                                                                    bool pollingEnabled,
                                                                    std::chrono::milliseconds pollingInterval);

class BEMS_EDGE_CORE_EXPORT EdgeService {
public:
    using WorkerCallback = std::function<void()>;

    explicit EdgeService(EdgeServiceConfig config,
                         std::shared_ptr<IBacnetClient> bacnetClient = nullptr);
    ~EdgeService();

    EdgeService(const EdgeService &) = delete;
    EdgeService &operator=(const EdgeService &) = delete;
    EdgeService(EdgeService &&) noexcept;
    EdgeService &operator=(EdgeService &&) noexcept;

    bool start();
    bool startPolling(std::chrono::milliseconds interval, WorkerCallback callback = {});
    void stop();
    bool running() const noexcept;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
