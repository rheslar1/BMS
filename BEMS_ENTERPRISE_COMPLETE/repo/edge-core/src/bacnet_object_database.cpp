#include "bacnet_object_database.h"

#include <algorithm>
#include <sstream>

namespace {

std::string boolArrayText(const std::array<bool, 4> &flags) {
    std::ostringstream out;
    out << "in-alarm=" << (flags[0] ? "true" : "false")
        << ", fault=" << (flags[1] ? "true" : "false")
        << ", overridden=" << (flags[2] ? "true" : "false")
        << ", out-of-service=" << (flags[3] ? "true" : "false");
    return out.str();
}

std::string priorityArrayText(const std::array<std::optional<double>, 16> &priorities) {
    std::ostringstream out;
    for (std::size_t i = 0; i < priorities.size(); ++i) {
        if (i > 0) {
            out << ", ";
        }
        out << (i + 1) << "=";
        if (priorities[i]) {
            out << *priorities[i];
        } else {
            out << "null";
        }
    }
    return out.str();
}

} // namespace

bool BacnetObjectIdentifier::operator<(const BacnetObjectIdentifier &other) const {
    if (type != other.type) {
        return static_cast<int>(type) < static_cast<int>(other.type);
    }
    return instance < other.instance;
}

bool BacnetObjectIdentifier::operator==(const BacnetObjectIdentifier &other) const {
    return type == other.type && instance == other.instance;
}

std::string bacnetObjectTypeName(BacnetObjectType type) {
    switch (type) {
    case BacnetObjectType::AnalogInput:
        return "analog-input";
    case BacnetObjectType::AnalogOutput:
        return "analog-output";
    case BacnetObjectType::AnalogValue:
        return "analog-value";
    case BacnetObjectType::BinaryInput:
        return "binary-input";
    case BacnetObjectType::BinaryOutput:
        return "binary-output";
    case BacnetObjectType::BinaryValue:
        return "binary-value";
    case BacnetObjectType::Device:
        return "device";
    case BacnetObjectType::Schedule:
        return "schedule";
    }
    return "unknown";
}

std::string bacnetObjectIdentifierText(BacnetObjectIdentifier identifier) {
    return bacnetObjectTypeName(identifier.type) + ":" + std::to_string(identifier.instance);
}

BacnetDeviceObjectDatabase::BacnetDeviceObjectDatabase(int deviceInstance)
    : deviceInstance_(deviceInstance) {
    upsertDeviceObject();
}

BacnetDeviceObjectDatabase BacnetDeviceObjectDatabase::createDefaultServerDevice(int deviceInstance) {
    BacnetDeviceObjectDatabase database(deviceInstance);
    database.addObject({{BacnetObjectType::AnalogInput, 1}, "Lobby Temperature", "Room temperature sensor", "degrees-celsius", 22.4});
    database.addObject({{BacnetObjectType::AnalogOutput, 1}, "VAV Damper Command", "Commanded damper position", "percent", 55.0, {false, false, false, false}, "normal", "no-fault-detected", false, {}, 0.0});
    database.addObject({{BacnetObjectType::AnalogValue, 1}, "Cooling Setpoint", "Occupied cooling setpoint", "degrees-celsius", 23.0, {false, false, false, false}, "normal", "no-fault-detected", false, {}, 23.0});
    database.addObject({{BacnetObjectType::BinaryInput, 1}, "Occupancy Status", "Room occupancy feedback", "no-units", 1.0});
    database.addObject({{BacnetObjectType::BinaryOutput, 1}, "Supply Fan Enable", "Fan command output", "no-units", 1.0, {false, false, false, false}, "normal", "no-fault-detected", false, {}, 0.0});
    database.addObject({{BacnetObjectType::BinaryValue, 1}, "Maintenance Lockout", "Software maintenance lockout", "no-units", 0.0, {false, false, false, false}, "normal", "no-fault-detected", false, {}, 0.0});
    BacnetObjectRecord schedule{{BacnetObjectType::Schedule, 1}, "Occupancy Schedule", "Device-resident occupied schedule", "schedule", 1.0};
    schedule.schedule = BacnetScheduleProperties{
        "mon-fri 07:00-18:00 occupied; sat-sun unoccupied",
        "holidays and special-events from retained device storage",
        "2026-01-01..2026-12-31",
    };
    database.addObject(schedule);
    return database;
}

bool BacnetDeviceObjectDatabase::addObject(const BacnetObjectRecord &record) {
    objects_[record.identifier] = record;
    upsertDeviceObject();
    return true;
}

const BacnetObjectRecord *BacnetDeviceObjectDatabase::findObject(BacnetObjectIdentifier identifier) const {
    const auto found = objects_.find(identifier);
    return found == objects_.end() ? nullptr : &found->second;
}

BacnetObjectRecord *BacnetDeviceObjectDatabase::findObject(BacnetObjectIdentifier identifier) {
    const auto found = objects_.find(identifier);
    return found == objects_.end() ? nullptr : &found->second;
}

std::vector<BacnetObjectIdentifier> BacnetDeviceObjectDatabase::objectList() const {
    std::vector<BacnetObjectIdentifier> identifiers;
    identifiers.reserve(objects_.size());
    for (const auto &entry : objects_) {
        identifiers.push_back(entry.first);
    }
    return identifiers;
}

std::size_t BacnetDeviceObjectDatabase::objectCount() const {
    return objects_.size();
}

std::optional<std::string> BacnetDeviceObjectDatabase::readPropertyText(BacnetObjectIdentifier identifier,
                                                                        BacnetPropertyIdentifier property) const {
    const auto *record = findObject(identifier);
    if (!record) {
        return std::nullopt;
    }

    switch (property) {
    case BacnetPropertyIdentifier::ObjectIdentifier:
        return bacnetObjectIdentifierText(record->identifier);
    case BacnetPropertyIdentifier::ObjectName:
        return record->name;
    case BacnetPropertyIdentifier::ObjectType:
        return bacnetObjectTypeName(record->identifier.type);
    case BacnetPropertyIdentifier::PresentValue:
        if (auto value = effectivePresentValue(identifier)) {
            return std::to_string(*value);
        }
        return std::to_string(record->presentValue);
    case BacnetPropertyIdentifier::Description:
        return record->description;
    case BacnetPropertyIdentifier::StatusFlags:
        return boolArrayText(record->statusFlags);
    case BacnetPropertyIdentifier::EventState:
        return record->eventState;
    case BacnetPropertyIdentifier::Reliability:
        return record->reliability;
    case BacnetPropertyIdentifier::OutOfService:
        return record->outOfService ? "true" : "false";
    case BacnetPropertyIdentifier::Units:
        return record->units;
    case BacnetPropertyIdentifier::PriorityArray:
        return priorityArrayText(record->priorityArray);
    case BacnetPropertyIdentifier::RelinquishDefault:
        return std::to_string(record->relinquishDefault);
    case BacnetPropertyIdentifier::ObjectList: {
        std::ostringstream out;
        const auto identifiers = objectList();
        for (std::size_t i = 0; i < identifiers.size(); ++i) {
            if (i > 0) {
                out << ", ";
            }
            out << bacnetObjectIdentifierText(identifiers[i]);
        }
        return out.str();
    }
    case BacnetPropertyIdentifier::VendorName:
        return "IntelliBuild Energy";
    case BacnetPropertyIdentifier::ModelName:
        return "BEMS Edge BACnet Server";
    case BacnetPropertyIdentifier::FirmwareRevision:
        return "edge-core-simulator";
    case BacnetPropertyIdentifier::ProtocolServicesSupported:
        return "Who-Is,I-Am,ReadProperty,ReadPropertyMultiple,WriteProperty,SubscribeCOV,ConfirmedCOVNotification,UnconfirmedCOVNotification";
    case BacnetPropertyIdentifier::WeeklySchedule:
        return record->schedule ? record->schedule->weeklySchedule : std::optional<std::string>{};
    case BacnetPropertyIdentifier::ExceptionSchedule:
        return record->schedule ? record->schedule->exceptionSchedule : std::optional<std::string>{};
    case BacnetPropertyIdentifier::EffectivePeriod:
        return record->schedule ? record->schedule->effectivePeriod : std::optional<std::string>{};
    }

    return std::nullopt;
}

bool BacnetDeviceObjectDatabase::writePresentValue(BacnetObjectIdentifier identifier, double value, int priority) {
    auto *record = findObject(identifier);
    if (!record || priority < 1 || priority > 16) {
        return false;
    }
    record->priorityArray[static_cast<std::size_t>(priority - 1)] = value;
    record->presentValue = *effectivePresentValue(identifier);
    return true;
}

bool BacnetDeviceObjectDatabase::releasePriority(BacnetObjectIdentifier identifier, int priority) {
    auto *record = findObject(identifier);
    if (!record || priority < 1 || priority > 16) {
        return false;
    }
    record->priorityArray[static_cast<std::size_t>(priority - 1)].reset();
    record->presentValue = *effectivePresentValue(identifier);
    return true;
}

std::optional<double> BacnetDeviceObjectDatabase::effectivePresentValue(BacnetObjectIdentifier identifier) const {
    const auto *record = findObject(identifier);
    if (!record) {
        return std::nullopt;
    }
    for (const auto &slot : record->priorityArray) {
        if (slot) {
            return *slot;
        }
    }
    if (record->relinquishDefault != 0.0) {
        return record->relinquishDefault;
    }
    return record->presentValue;
}

void BacnetDeviceObjectDatabase::upsertDeviceObject() {
    BacnetObjectRecord device{{BacnetObjectType::Device, deviceInstance_},
                              "IntelliBuild BACnet Edge Device",
                              "BACnet server/device object database for the BEMS edge core",
                              "no-units",
                              0.0};
    device.reliability = "no-fault-detected";
    objects_[device.identifier] = device;
}
