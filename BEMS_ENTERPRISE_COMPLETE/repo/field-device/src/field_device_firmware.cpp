#include "field_device_firmware.h"

namespace bems::field_device {

void BareMetalFieldDeviceApplication::sampleIo()
{
    for (const auto &objectId : objectTable_.objects()) {
        (void)objectTable_.readPresentValue(objectId);
    }
}

void BareMetalFieldDeviceApplication::runControl(double deltaSeconds)
{
    controlStrategy_.evaluate(deltaSeconds);
}

void BareMetalFieldDeviceApplication::publishBacnetObjects()
{
    for (const auto &objectId : objectTable_.objects()) {
        auto value = objectTable_.readPresentValue(objectId);
        if (value.has_value()) {
            (void)objectTable_.writePresentValue(*value);
        }
    }
}

void BareMetalFieldDeviceApplication::serviceWatchdog()
{
    (void)persistentStore_.verifyChecksum("device-configuration");
    (void)scheduleRepository_.loadSchedules();
    (void)otaUpdater_.status();
}

} // namespace bems::field_device
