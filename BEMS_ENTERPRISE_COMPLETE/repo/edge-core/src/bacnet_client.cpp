#include "bacnet_client.h"
#include "bacnet_interface.h"

BacnetStackClient::~BacnetStackClient() {
    shutdown();
}

bool BacnetStackClient::initialize(const std::string &localDeviceId, const std::string &localIpAddress, unsigned short localPort) {
    initialized_ = bacnet_initialize(localDeviceId.c_str(), localIpAddress.c_str(), localPort);
    return initialized_;
}

bool BacnetStackClient::discoverDevice(int deviceInstance, DeviceDetails &outDevice) {
    BacnetDeviceInfo info{};
    if (!bacnet_discover_device(deviceInstance, &info)) {
        return false;
    }

    outDevice.bacnetInstance = info.deviceInstance;
    outDevice.objectInstance = info.objectInstance;
    outDevice.name = info.objectName ? info.objectName : "BACnet Device";
    outDevice.objectType = info.objectType ? info.objectType : "analogInput";
    outDevice.vendor = info.vendor ? info.vendor : "Unknown";
    outDevice.model = info.model ? info.model : "Unknown";
    outDevice.ipAddress = info.ipAddress ? info.ipAddress : "";
    outDevice.units = info.units ? info.units : "";
    outDevice.presentValue = info.presentValue;
    outDevice.status = info.status ? info.status : "unknown";
    return true;
}

bool BacnetStackClient::readProperty(const BacnetPointAddress &address, double &outValue) {
    return bacnet_read_property(address.deviceInstance, address.objectType, address.objectInstance, &outValue);
}

bool BacnetStackClient::writeProperty(const BacnetPointAddress &address, double value) {
    return bacnet_write_property(address.deviceInstance, address.objectType, address.objectInstance, value);
}

void BacnetStackClient::shutdown() {
    if (initialized_) {
        bacnet_shutdown();
        initialized_ = false;
    }
}

std::shared_ptr<IBacnetClient> createDefaultBacnetClient() {
    return std::make_shared<BacnetStackClient>();
}
