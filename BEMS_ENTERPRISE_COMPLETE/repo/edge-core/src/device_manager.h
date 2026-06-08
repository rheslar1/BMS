#pragma once

#include <memory>
#include <string>
#include <vector>

class IBacnetClient;

struct DeviceDetails {
    int id;
    int zoneId;
    int bacnetInstance;
    int objectInstance;
    std::string name;
    std::string type;
    std::string vendor;
    std::string model;
    std::string ipAddress;
    std::string objectType;
    std::string units;
    double presentValue;
    std::string status;
};

class DeviceManager {
public:
    explicit DeviceManager(const std::string &localAddress);
    DeviceManager(const std::string &localAddress, std::shared_ptr<IBacnetClient> bacnetClient);
    DeviceManager(const std::string &localAddress, unsigned short localPort, std::shared_ptr<IBacnetClient> bacnetClient);
    ~DeviceManager();

    bool initialize();
    bool refreshDevice(DeviceDetails &device);
    bool readPoint(int deviceInstance, int objectType, int objectInstance, double &outValue);
    std::vector<DeviceDetails> &getDevices();
    const std::vector<DeviceDetails> &getDevices() const;

private:
    std::string localAddress_;
    unsigned short localPort_{47808};
    std::shared_ptr<IBacnetClient> bacnetClient_;
    std::vector<DeviceDetails> devices_;
};
