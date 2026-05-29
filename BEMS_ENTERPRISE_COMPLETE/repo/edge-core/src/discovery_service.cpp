#include "discovery_service.h"
#include <utility>

BacnetDeviceDiscovery::BacnetDeviceDiscovery(std::shared_ptr<IBacnetClient> bacnetClient)
    : bacnetClient_(std::move(bacnetClient)) {}

std::vector<DeviceDetails> BacnetDeviceDiscovery::discover(int lowInstance, int highInstance) {
    std::vector<DeviceDetails> discovered;
    int nextId = 1;

    for (int instance = lowInstance; instance <= highInstance; ++instance) {
        DeviceDetails device{};
        if (bacnetClient_->discoverDevice(instance, device)) {
            device.id = nextId++;
            device.zoneId = 0;
            device.type = "BACnet";
            device.vendor = "Unknown";
            device.model = "Unknown";
            discovered.push_back(device);
        }
    }

    return discovered;
}
