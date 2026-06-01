#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace bems::field_device {

enum class BacnetObjectType {
    AnalogInput,
    AnalogOutput,
    AnalogValue,
    BinaryInput,
    BinaryOutput,
    BinaryValue,
    Schedule
};

struct BacnetObjectId {
    BacnetObjectType type;
    std::uint32_t instance;
};

inline bool operator==(const BacnetObjectId &left, const BacnetObjectId &right)
{
    return left.type == right.type && left.instance == right.instance;
}

struct BacnetPropertyValue {
    BacnetObjectId objectId;
    std::string propertyName;
    double numericValue{0.0};
    std::string units;
    std::string reliability{"no-fault-detected"};
};

struct DeviceScheduleEntry {
    std::string name;
    std::string days;
    std::string startTime;
    std::string endTime;
    std::string action;
    double targetValue{0.0};
    std::string units;
    bool enabled{true};
};

struct OtaUpdateRequest {
    std::string version;
    std::string channel;
    std::string artifactUri;
    std::string checksum;
    std::string signature;
    bool rollbackAllowed{true};
};

struct OtaUpdateStatus {
    std::string state{"idle"};
    std::string activeVersion;
    std::string stagedVersion;
    std::string activeSlot{"A"};
    std::string stagedSlot;
    std::string previousSlot;
    bool bootConfirmed{true};
    std::string message;
};

class IBacnetObjectTable {
public:
    virtual ~IBacnetObjectTable() = default;
    virtual std::vector<BacnetObjectId> objects() const = 0;
    virtual std::optional<BacnetPropertyValue> readPresentValue(BacnetObjectId objectId) const = 0;
    virtual bool writePresentValue(const BacnetPropertyValue &value) = 0;
};

class IPersistentStore {
public:
    virtual ~IPersistentStore() = default;
    virtual bool writeBlob(const std::string &key, const std::vector<std::uint8_t> &payload) = 0;
    virtual std::vector<std::uint8_t> readBlob(const std::string &key) const = 0;
    virtual bool verifyChecksum(const std::string &key) const = 0;
};

class ITransportPort {
public:
    virtual ~ITransportPort() = default;
    virtual bool send(const std::vector<std::uint8_t> &frame) = 0;
    virtual std::vector<std::uint8_t> receive() = 0;
    virtual std::string medium() const = 0;
};

class IScheduleRepository {
public:
    virtual ~IScheduleRepository() = default;
    virtual bool saveSchedules(const std::vector<DeviceScheduleEntry> &entries) = 0;
    virtual std::vector<DeviceScheduleEntry> loadSchedules() const = 0;
};

class IOtaUpdater {
public:
    virtual ~IOtaUpdater() = default;
    virtual bool stage(const OtaUpdateRequest &request) = 0;
    virtual bool applyStagedImage() = 0;
    virtual bool rollback() = 0;
    virtual OtaUpdateStatus status() const = 0;
};

class ISignatureVerifier {
public:
    virtual ~ISignatureVerifier() = default;
    virtual bool verify(const OtaUpdateRequest &request) const = 0;
};

class IControlStrategy {
public:
    virtual ~IControlStrategy() = default;
    virtual void evaluate(double deltaSeconds) = 0;
};

class IFieldDeviceApplication {
public:
    virtual ~IFieldDeviceApplication() = default;
    virtual void sampleIo() = 0;
    virtual void runControl(double deltaSeconds) = 0;
    virtual void publishBacnetObjects() = 0;
    virtual void serviceWatchdog() = 0;
};

class BareMetalFieldDeviceApplication final : public IFieldDeviceApplication {
public:
    BareMetalFieldDeviceApplication(IBacnetObjectTable &objectTable,
                                    IPersistentStore &persistentStore,
                                    IScheduleRepository &scheduleRepository,
                                    IOtaUpdater &otaUpdater,
                                    IControlStrategy &controlStrategy)
        : objectTable_(objectTable),
          persistentStore_(persistentStore),
          scheduleRepository_(scheduleRepository),
          otaUpdater_(otaUpdater),
          controlStrategy_(controlStrategy) {}

    void sampleIo() override;
    void runControl(double deltaSeconds) override;
    void publishBacnetObjects() override;
    void serviceWatchdog() override;

private:
    IBacnetObjectTable &objectTable_;
    IPersistentStore &persistentStore_;
    IScheduleRepository &scheduleRepository_;
    IOtaUpdater &otaUpdater_;
    IControlStrategy &controlStrategy_;
};

} // namespace bems::field_device
