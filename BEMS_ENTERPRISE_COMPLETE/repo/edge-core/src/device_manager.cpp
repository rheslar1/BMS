#include "device_manager.h"
#include "bacnet_client.h"
#include <algorithm>
#include <iostream>
#include <utility>

namespace {

int bacnetObjectTypeCode(const std::string &objectType) {
    if (objectType == "analogInput") return 0;
    if (objectType == "analogOutput") return 1;
    if (objectType == "analogValue") return 2;
    if (objectType == "binaryInput") return 3;
    if (objectType == "binaryOutput") return 4;
    if (objectType == "binaryValue") return 5;
    if (objectType == "device") return 8;
    if (objectType == "schedule") return 17;
    return 0;
}

} // namespace

DeviceManager::DeviceManager(const std::string &localAddress)
    : DeviceManager(localAddress, createDefaultBacnetClient()) {}

DeviceManager::DeviceManager(const std::string &localAddress, std::shared_ptr<IBacnetClient> bacnetClient)
    : DeviceManager(localAddress, 47808, std::move(bacnetClient)) {}

DeviceManager::DeviceManager(const std::string &localAddress,
                             unsigned short localPort,
                             std::shared_ptr<IBacnetClient> bacnetClient)
    : localAddress_(localAddress),
      localPort_(localPort),
      bacnetClient_(std::move(bacnetClient)),
      devices_{
        {1, 1, 101, 1, "Lobby Temperature Sensor", "Analog Input", "VendorA", "TS-100", "192.168.1.11", "analogInput", "Celsius", 22.4, "normal"},
        {2, 1, 102, 1, "Floor 1 VAV", "Analog Output", "VendorA", "VAV-200", "192.168.1.12", "analogOutput", "Percent", 55.0, "normal"},
        {3, 2, 201, 1, "Floor 1 Fan", "Binary Output", "VendorB", "FAN-75", "192.168.1.13", "binaryOutput", "On/Off", 1.0, "on"},
        {4, 1, 250, 1, "Occupancy Schedule", "Schedule", "VendorA", "SCH-1", "192.168.1.14", "schedule", "Schedule", 1.0, "normal"},
      } {}

DeviceManager::~DeviceManager() {
    bacnetClient_->shutdown();
}

bool DeviceManager::initialize() {
    if (!bacnetClient_->initialize("EdgeCoreDevice", localAddress_, localPort_)) {
        std::cerr << "Failed to initialize BACnet stack." << std::endl;
        return false;
    }
    return true;
}

bool DeviceManager::refreshDevice(DeviceDetails &device) {
    double value;
    if (!bacnetClient_->readProperty({device.bacnetInstance, bacnetObjectTypeCode(device.objectType), device.objectInstance}, value)) {
        std::cerr << "Failed to read property for device " << device.id << std::endl;
        return false;
    }
    device.presentValue = value;
    device.status = "normal";
    return true;
}

bool DeviceManager::readPoint(int deviceInstance, int objectType, int objectInstance, double &outValue) {
    const auto cachedPoint = std::find_if(devices_.begin(), devices_.end(), [&](const DeviceDetails &device) {
        return device.bacnetInstance == deviceInstance &&
               bacnetObjectTypeCode(device.objectType) == objectType &&
               device.objectInstance == objectInstance;
    });

    if (cachedPoint == devices_.end()) {
        return bacnetClient_->readProperty({deviceInstance, objectType, objectInstance}, outValue);
    }

    return bacnetClient_->readProperty(
        {cachedPoint->bacnetInstance, objectType, cachedPoint->objectInstance},
        outValue);
}

std::vector<DeviceDetails> &DeviceManager::getDevices() {
    return devices_;
}

const std::vector<DeviceDetails> &DeviceManager::getDevices() const {
    return devices_;
}
