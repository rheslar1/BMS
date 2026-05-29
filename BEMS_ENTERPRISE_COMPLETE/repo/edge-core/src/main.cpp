#include "bacnet_client.h"
#include "discovery_service.h"
#include "edge_runtime.h"
#include <chrono>
#include <cstdlib>
#include <memory>
#include <string>
#include <thread>
#include <utility>

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

  while (true) {
    runtime.pollOnce();
    std::this_thread::sleep_for(std::chrono::seconds(10));
  }

  return 0;
}
