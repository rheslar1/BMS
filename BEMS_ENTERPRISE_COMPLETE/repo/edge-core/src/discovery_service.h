#pragma once

#include "bacnet_client.h"
#include <memory>
#include <vector>

class IDeviceDiscovery {
public:
    virtual ~IDeviceDiscovery() = default;
    virtual std::vector<DeviceDetails> discover(int lowInstance, int highInstance) = 0;
};

class BacnetDeviceDiscovery final : public IDeviceDiscovery {
public:
    explicit BacnetDeviceDiscovery(std::shared_ptr<IBacnetClient> bacnetClient);

    std::vector<DeviceDetails> discover(int lowInstance, int highInstance) override;

private:
    std::shared_ptr<IBacnetClient> bacnetClient_;
};
