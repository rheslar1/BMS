#include "bacnet_interface.h"
#include "bacnet_object_database.h"

#include <cassert>
#include <cstring>
#include <string>

bool contains(const char *text, const char *fragment) {
    return std::string(text).find(fragment) != std::string::npos;
}

void testDeviceObjectDatabaseContainsStandardObjects() {
    auto database = BacnetDeviceObjectDatabase::createDefaultServerDevice(4194303);
    assert(database.objectCount() >= 8);

    const auto *device = database.findObject({BacnetObjectType::Device, 4194303});
    assert(device);
    assert(device->name == "IntelliBuild BACnet Edge Device");

    const auto objectList = database.readPropertyText(
        {BacnetObjectType::Device, 4194303},
        BacnetPropertyIdentifier::ObjectList);
    assert(objectList);
    assert(objectList->find("analog-input:1") != std::string::npos);
    assert(objectList->find("schedule:1") != std::string::npos);

    const auto services = database.readPropertyText(
        {BacnetObjectType::Device, 4194303},
        BacnetPropertyIdentifier::ProtocolServicesSupported);
    assert(services);
    assert(services->find("ReadPropertyMultiple") != std::string::npos);
    assert(services->find("ConfirmedCOVNotification") != std::string::npos);
}

void testStandardObjectPropertiesAndPriorityArray() {
    auto database = BacnetDeviceObjectDatabase::createDefaultServerDevice(4194303);
    assert(database.writePresentValue({BacnetObjectType::AnalogOutput, 1}, 80.0, 8));
    assert(database.writePresentValue({BacnetObjectType::AnalogOutput, 1}, 40.0, 4));

    const auto value = database.effectivePresentValue({BacnetObjectType::AnalogOutput, 1});
    assert(value);
    assert(*value == 40.0);

    const auto priorityArray = database.readPropertyText(
        {BacnetObjectType::AnalogOutput, 1},
        BacnetPropertyIdentifier::PriorityArray);
    assert(priorityArray);
    assert(priorityArray->find("4=40") != std::string::npos);
    assert(priorityArray->find("8=80") != std::string::npos);

    assert(database.releasePriority({BacnetObjectType::AnalogOutput, 1}, 4));
    const auto releasedValue = database.effectivePresentValue({BacnetObjectType::AnalogOutput, 1});
    assert(releasedValue);
    assert(*releasedValue == 80.0);

    const auto statusFlags = database.readPropertyText(
        {BacnetObjectType::AnalogOutput, 1},
        BacnetPropertyIdentifier::StatusFlags);
    assert(statusFlags);
    assert(statusFlags->find("out-of-service=false") != std::string::npos);
}

void testScheduleProperties() {
    auto database = BacnetDeviceObjectDatabase::createDefaultServerDevice(4194303);
    const auto weekly = database.readPropertyText({BacnetObjectType::Schedule, 1}, BacnetPropertyIdentifier::WeeklySchedule);
    const auto exceptions = database.readPropertyText({BacnetObjectType::Schedule, 1}, BacnetPropertyIdentifier::ExceptionSchedule);
    const auto period = database.readPropertyText({BacnetObjectType::Schedule, 1}, BacnetPropertyIdentifier::EffectivePeriod);
    assert(weekly);
    assert(exceptions);
    assert(period);
    assert(weekly->find("mon-fri") != std::string::npos);
    assert(exceptions->find("holidays") != std::string::npos);
    assert(period->find("2026") != std::string::npos);
}

void testCBoundaryExposesServerObjectDatabase() {
    assert(bacnet_server_object_count() >= 8);

    char buffer[1024]{};
    assert(bacnet_server_read_property_text(8, 4194303, 76, buffer, sizeof(buffer)));
    assert(contains(buffer, "analog-value:1"));
    assert(contains(buffer, "schedule:1"));

    assert(bacnet_server_read_property_text(8, 4194303, 97, buffer, sizeof(buffer)));
    assert(contains(buffer, "ReadPropertyMultiple"));

    assert(bacnet_server_write_present_value(2, 1, 24.5, 8));
    assert(bacnet_server_read_property_text(2, 1, 85, buffer, sizeof(buffer)));
    assert(contains(buffer, "24.500000"));

    assert(bacnet_server_release_priority(2, 1, 8));
    assert(bacnet_server_read_property_text(17, 1, 123, buffer, sizeof(buffer)));
    assert(contains(buffer, "mon-fri"));

    bacnet_shutdown();
}

int main() {
    testDeviceObjectDatabaseContainsStandardObjects();
    testStandardObjectPropertiesAndPriorityArray();
    testScheduleProperties();
    testCBoundaryExposesServerObjectDatabase();
    return 0;
}
