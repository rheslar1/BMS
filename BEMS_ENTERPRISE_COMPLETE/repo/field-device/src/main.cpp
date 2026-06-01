#include "field_device_firmware.h"
#include "simulated_drivers.h"

#include <iostream>

using namespace bems::field_device;

int main()
{
    SimulatedFlashStore flash;
    SimulatedBacnetObjectTable objects;
    objects.addObject({{BacnetObjectType::AnalogValue, 1}, "present-value", 21.5, "Celsius"});

    FlashScheduleRepository schedules(flash);
    SharedKeySignatureVerifier verifier("dev-field-device-key");
    SignedBootloaderOtaUpdater ota(flash, verifier);
    FixedSetpointStrategy control(objects, {BacnetObjectType::AnalogValue, 1}, 22.0);
    BareMetalFieldDeviceApplication app(objects, flash, schedules, ota, control);

    app.sampleIo();
    app.runControl(1.0);
    app.publishBacnetObjects();
    app.serviceWatchdog();

    auto value = objects.readPresentValue({BacnetObjectType::AnalogValue, 1});
    std::cout << "field-device firmware simulator present-value=" << (value ? value->numericValue : 0.0) << "\n";
    return value.has_value() ? 0 : 1;
}
