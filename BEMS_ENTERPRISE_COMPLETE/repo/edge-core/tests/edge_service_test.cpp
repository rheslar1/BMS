#include "bacnet_client.h"
#include "edge_service.h"

#include <atomic>
#include <cassert>
#include <chrono>
#include <string>
#include <thread>

class FailingBacnetClient final : public IBacnetClient {
public:
    bool initialize(const std::string &, const std::string &, unsigned short) override { return false; }
    bool discoverDevice(int, DeviceDetails &) override { return false; }
    bool readProperty(const BacnetPointAddress &, double &) override { return false; }
    bool writeProperty(const BacnetPointAddress &, double) override { return false; }
    void shutdown() override { shutdownCalled = true; }

    bool shutdownCalled{false};
};

class SuccessfulBacnetClient final : public IBacnetClient {
public:
    bool initialize(const std::string &, const std::string &, unsigned short) override { return true; }
    bool discoverDevice(int, DeviceDetails &) override { return false; }
    bool readProperty(const BacnetPointAddress &, double &outValue) override {
        outValue = 42.0;
        return true;
    }
    bool writeProperty(const BacnetPointAddress &, double) override { return true; }
    void shutdown() override { shutdownCalled = true; }

    bool shutdownCalled{false};
};

void testStartupFailureCleansUpOwnedRuntime() {
    auto client = std::make_shared<FailingBacnetClient>();
    {
        EdgeService service(EdgeServiceConfig{}, client);
        assert(!service.start());
        assert(!service.running());
    }

    assert(client->shutdownCalled);
}

void testDefaultConfigFactoryReturnsLargeConfigByValue() {
    const EdgeServiceConfig config = makeDefaultEdgeServiceConfig(
        "127.0.0.1",
        0,
        true,
        std::chrono::milliseconds(250));

    assert(config.localAddress == "127.0.0.1");
    assert(config.localPort == 0);
    assert(config.pollingEnabled);
    assert(config.pollingInterval == std::chrono::milliseconds(250));
    assert(config.telemetryPoints.size() == 4);
    assert(config.telemetryPoints[0].name == "lobby-temperature");
}

void testWorkerThreadInvokesCallbackLambda() {
    auto client = std::make_shared<SuccessfulBacnetClient>();
    EdgeService service(EdgeServiceConfig{}, client);
    assert(service.start());

    std::atomic_int callbackCount{0};
    assert(service.startPolling(std::chrono::milliseconds(1), [&callbackCount]() {
        callbackCount.fetch_add(1);
    }));

    for (int attempt = 0; attempt < 100 && callbackCount.load() == 0; ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }

    service.stop();
    assert(callbackCount.load() > 0);
}

int main() {
    testStartupFailureCleansUpOwnedRuntime();
    testDefaultConfigFactoryReturnsLargeConfigByValue();
    testWorkerThreadInvokesCallbackLambda();
    return 0;
}
