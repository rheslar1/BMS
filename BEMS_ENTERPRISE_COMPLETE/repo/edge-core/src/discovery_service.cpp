#include "discovery_service.h"
#include <algorithm>
#include <cstddef>
#include <utility>

BacnetDeviceDiscovery::BacnetDeviceDiscovery(std::shared_ptr<IBacnetClient> bacnetClient)
    : bacnetClient_(std::move(bacnetClient)) {}

std::vector<DeviceDetails> BacnetDeviceDiscovery::discover(int lowInstance, int highInstance) {
    std::vector<DeviceDetails> discovered;
    if (lowInstance <= highInstance) {
        discovered.reserve(static_cast<std::size_t>(highInstance - lowInstance + 1));
    }

    for (int instance = lowInstance; instance <= highInstance; ++instance) {
        DeviceDetails device{};
        if (bacnetClient_->discoverDevice(instance, device)) {
            device.zoneId = 0;
            device.type = "BACnet";
            discovered.push_back(device);
        }
    }

    std::sort(discovered.begin(), discovered.end(), [](const DeviceDetails &left, const DeviceDetails &right) {
        return left.bacnetInstance < right.bacnetInstance;
    });

    int nextId = 1;
    for (auto &device : discovered) {
        device.id = nextId++;
    }

    return discovered;
}
