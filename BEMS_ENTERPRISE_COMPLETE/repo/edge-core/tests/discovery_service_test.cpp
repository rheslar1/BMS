#include "discovery_service.h"

#include <cassert>
#include <map>
#include <memory>
#include <string>

class FakeDiscoveryClient final : public IBacnetClient {
public:
    bool initialize(const std::string &, const std::string &, unsigned short) override { return true; }

    bool discoverDevice(int deviceInstance, DeviceDetails &outDevice) override {
        requested_[deviceInstance] += 1;
        const auto found = devices_.find(deviceInstance);
        if (found == devices_.end()) {
            return false;
        }
        outDevice = found->second;
        return true;
    }

    bool readProperty(const BacnetPointAddress &, double &) override { return false; }
    bool writeProperty(const BacnetPointAddress &, double) override { return false; }
    void shutdown() override {}

    std::map<int, DeviceDetails> devices_;
    std::map<int, int> requested_;
};

DeviceDetails makeDevice(int instance, const std::string &name) {
    DeviceDetails device{};
    device.bacnetInstance = instance;
    device.objectInstance = 1;
    device.name = name;
    device.vendor = "Unit Test";
    device.model = "Fake";
    device.ipAddress = "127.0.0.1";
    device.objectType = "analogInput";
    device.units = "C";
    device.presentValue = 21.5;
    device.status = "Normal";
    return device;
}

void testDiscoversOnlyReachableDevicesInRange() {
    auto client = std::make_shared<FakeDiscoveryClient>();
    client->devices_[101] = makeDevice(101, "Supply Temperature");
    client->devices_[103] = makeDevice(103, "Zone Temperature");

    BacnetDeviceDiscovery discovery(client);
    const auto devices = discovery.discover(100, 103);

    assert(devices.size() == 2);
    assert(devices[0].id == 1);
    assert(devices[1].id == 2);
    assert(devices[0].zoneId == 0);
    assert(devices[0].type == "BACnet");
    assert(devices[0].bacnetInstance == 101);
    assert(devices[1].bacnetInstance == 103);
    assert(client->requested_[100] == 1);
    assert(client->requested_[102] == 1);
}

void testEmptyRangeReturnsNoDevices() {
    auto client = std::make_shared<FakeDiscoveryClient>();
    BacnetDeviceDiscovery discovery(client);

    const auto devices = discovery.discover(200, 199);
    assert(devices.empty());
    assert(client->requested_.empty());
}

int main() {
    testDiscoversOnlyReachableDevicesInRange();
    testEmptyRangeReturnsNoDevices();
    return 0;
}

