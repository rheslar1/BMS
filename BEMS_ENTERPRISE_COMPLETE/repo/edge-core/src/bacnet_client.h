#pragma once

#include "device_manager.h"
#include <memory>
#include <string>

struct BacnetPointAddress {
    int deviceInstance;
    int objectType;
    int objectInstance;
};

class IBacnetClient {
public:
    virtual ~IBacnetClient() = default;

    virtual bool initialize(const std::string &localDeviceId, const std::string &localIpAddress, unsigned short localPort) = 0;
    virtual bool discoverDevice(int deviceInstance, DeviceDetails &outDevice) = 0;
    virtual bool readProperty(const BacnetPointAddress &address, double &outValue) = 0;
    virtual bool writeProperty(const BacnetPointAddress &address, double value) = 0;
    virtual void shutdown() = 0;
};

class BacnetStackClient final : public IBacnetClient {
public:
    ~BacnetStackClient() override;

    bool initialize(const std::string &localDeviceId, const std::string &localIpAddress, unsigned short localPort) override;
    bool discoverDevice(int deviceInstance, DeviceDetails &outDevice) override;
    bool readProperty(const BacnetPointAddress &address, double &outValue) override;
    bool writeProperty(const BacnetPointAddress &address, double value) override;
    void shutdown() override;

private:
    bool initialized_ = false;
};

std::shared_ptr<IBacnetClient> createDefaultBacnetClient();
