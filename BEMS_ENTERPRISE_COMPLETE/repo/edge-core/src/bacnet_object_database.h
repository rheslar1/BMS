#pragma once

#include <array>
#include <map>
#include <optional>
#include <string>
#include <vector>

enum class BacnetObjectType {
    AnalogInput = 0,
    AnalogOutput = 1,
    AnalogValue = 2,
    BinaryInput = 3,
    BinaryOutput = 4,
    BinaryValue = 5,
    Device = 8,
    Schedule = 17,
};

enum class BacnetPropertyIdentifier {
    ObjectIdentifier = 75,
    ObjectName = 77,
    ObjectType = 79,
    PresentValue = 85,
    Description = 28,
    StatusFlags = 111,
    EventState = 36,
    Reliability = 103,
    OutOfService = 81,
    Units = 117,
    PriorityArray = 87,
    RelinquishDefault = 104,
    ObjectList = 76,
    VendorName = 121,
    ModelName = 70,
    FirmwareRevision = 44,
    ProtocolServicesSupported = 97,
    WeeklySchedule = 123,
    ExceptionSchedule = 38,
    EffectivePeriod = 32,
};

struct BacnetObjectIdentifier {
    BacnetObjectType type;
    int instance;

    bool operator<(const BacnetObjectIdentifier &other) const;
    bool operator==(const BacnetObjectIdentifier &other) const;
};

struct BacnetScheduleProperties {
    std::string weeklySchedule;
    std::string exceptionSchedule;
    std::string effectivePeriod;
};

struct BacnetObjectRecord {
    BacnetObjectIdentifier identifier;
    std::string name;
    std::string description;
    std::string units;
    double presentValue{0.0};
    std::array<bool, 4> statusFlags{false, false, false, false};
    std::string eventState{"normal"};
    std::string reliability{"no-fault-detected"};
    bool outOfService{false};
    std::array<std::optional<double>, 16> priorityArray{};
    double relinquishDefault{0.0};
    std::optional<BacnetScheduleProperties> schedule;
};

class BacnetDeviceObjectDatabase {
public:
    explicit BacnetDeviceObjectDatabase(int deviceInstance);

    static BacnetDeviceObjectDatabase createDefaultServerDevice(int deviceInstance);

    bool addObject(const BacnetObjectRecord &record);
    const BacnetObjectRecord *findObject(BacnetObjectIdentifier identifier) const;
    BacnetObjectRecord *findObject(BacnetObjectIdentifier identifier);
    std::vector<BacnetObjectIdentifier> objectList() const;
    std::size_t objectCount() const;

    std::optional<std::string> readPropertyText(BacnetObjectIdentifier identifier,
                                                BacnetPropertyIdentifier property) const;
    bool writePresentValue(BacnetObjectIdentifier identifier, double value, int priority);
    bool releasePriority(BacnetObjectIdentifier identifier, int priority);
    std::optional<double> effectivePresentValue(BacnetObjectIdentifier identifier) const;

private:
    int deviceInstance_;
    std::map<BacnetObjectIdentifier, BacnetObjectRecord> objects_;

    void upsertDeviceObject();
};

std::string bacnetObjectTypeName(BacnetObjectType type);
std::string bacnetObjectIdentifierText(BacnetObjectIdentifier identifier);
