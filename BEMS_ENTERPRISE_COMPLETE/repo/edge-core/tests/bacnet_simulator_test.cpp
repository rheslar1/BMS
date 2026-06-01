#include "bacnet_interface.h"

#include <cassert>
#include <cmath>
#include <cstdlib>
#include <cstring>

bool near(double left, double right) {
    return std::fabs(left - right) < 0.0001;
}

void testDiscoversSimulatedDevice() {
    setenv("BACNET_SIMULATOR_ENABLED", "true", 1);

    assert(bacnet_initialize("test-edge", "0.0.0.0", 47808));

    BacnetDeviceInfo info{};
    assert(bacnet_discover_device(102, &info));
    assert(info.deviceInstance == 102);
    assert(info.objectInstance == 1);
    assert(std::strcmp(info.objectName, "SIM Floor 1 VAV Damper") == 0);
    assert(std::strcmp(info.objectType, "analogOutput") == 0);
    assert(std::strcmp(info.vendor, "BEMS Simulator") == 0);
    assert(std::strcmp(info.ipAddress, "10.10.0.102") == 0);
    assert(near(info.presentValue, 55.0));

    BacnetDeviceInfo schedule{};
    assert(bacnet_discover_device(250, &schedule));
    assert(schedule.deviceInstance == 250);
    assert(std::strcmp(schedule.objectType, "schedule") == 0);

    BacnetDeviceInfo missing{};
    assert(!bacnet_discover_device(999, &missing));
}

void testReadWriteSimulatedPresentValue() {
    double value = 0.0;
    assert(bacnet_read_property(102, 1, 1, &value));
    assert(near(value, 55.0));

    assert(bacnet_write_property(102, 1, 1, 61.5));
    assert(bacnet_read_property(102, 1, 1, &value));
    assert(near(value, 61.5));
}

void testReadPropertyMultipleSimulatedPresentValues() {
    BacnetReadPropertyRequest requests[] = {
        {101, 0, 1},
        {102, 1, 1},
        {999, 1, 1},
    };
    BacnetReadPropertyResult results[3]{};

    assert(bacnet_read_properties_multiple(requests, 3, results));
    assert(results[0].success);
    assert(near(results[0].value, 22.4));
    assert(results[1].success);
    assert(near(results[1].value, 61.5));
    assert(!results[2].success);
}

void testSubscribesToSimulatedCov() {
    assert(bacnet_subscribe_cov(102, 1, 1, 7, 300, false));
    assert(!bacnet_subscribe_cov(999, 1, 1, 7, 300, false));

    assert(bacnet_write_property(102, 1, 1, 63.25));
    BacnetCovNotification notification{};
    assert(bacnet_poll_cov_notification(&notification, 0));
    assert(notification.deviceInstance == 102);
    assert(notification.objectType == 1);
    assert(notification.objectInstance == 1);
    assert(notification.subscriberProcessId == 7);
    assert(!notification.confirmed);
    assert(near(notification.value, 63.25));
}

int main() {
    testDiscoversSimulatedDevice();
    testReadWriteSimulatedPresentValue();
    testReadPropertyMultipleSimulatedPresentValues();
    testSubscribesToSimulatedCov();
    bacnet_shutdown();
    return 0;
}
