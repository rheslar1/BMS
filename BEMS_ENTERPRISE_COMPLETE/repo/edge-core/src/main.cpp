#include "bacnet_client.h"
#include "discovery_service.h"
#include "edge_runtime.h"
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <utility>

namespace {

bool envEnabled(const char *name) {
  const char *value = std::getenv(name);
  if (!value) return false;
  const std::string normalized(value);
  return normalized == "1" || normalized == "true" || normalized == "TRUE" || normalized == "yes" || normalized == "on";
}

} // namespace

int main() {
  auto bacnetClient = createDefaultBacnetClient();
  const char *localIp = std::getenv("BACNET_LOCAL_IP");
  DeviceManager manager(localIp && *localIp ? std::string(localIp) : "0.0.0.0", bacnetClient);
  auto discovery = std::make_unique<BacnetDeviceDiscovery>(bacnetClient);
  auto writeback = std::make_unique<SafeWritebackController>(bacnetClient);
  EdgeRuntime runtime(std::move(manager), EnergyAI{}, std::move(discovery), std::move(writeback));

  if (!runtime.initialize()) {
    return 1;
  }

  runtime.printStartupSummary();

  if (envEnabled("EDGE_POLLING_ENABLED")) {
    std::thread poller([&runtime]() {
      while (true) {
        runtime.pollOnce();
        std::this_thread::sleep_for(std::chrono::seconds(10));
      }
    });
    poller.detach();
  }

  std::cout << "Edge runtime ready for RabbitMQ AMQP command orchestration and BACnet/IP field integration." << std::endl;
  while (true) {
    std::this_thread::sleep_for(std::chrono::seconds(60));
  }

  return 0;
}
