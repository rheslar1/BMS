#include "field_device_firmware.h"
#include "simulated_drivers.h"

#include <cassert>
#include <string>

using namespace bems::field_device;

int main()
{
    SimulatedFlashStore flash;
    assert(flash.writeBlob("device-configuration", {1, 2, 3, 4}));
    assert(flash.verifyChecksum("device-configuration"));

    SimulatedBacnetObjectTable objects;
    BacnetObjectId setpoint{BacnetObjectType::AnalogValue, 1};
    objects.addObject({setpoint, "present-value", 20.0, "Celsius"});

    FlashScheduleRepository schedules(flash);
    assert(schedules.saveSchedules({{"Occupied", "Mon,Tue,Wed,Thu,Fri", "06:00:00", "18:00:00", "setpoint", 22.0, "Celsius", true}}));
    assert(!schedules.loadSchedules().empty());

    SharedKeySignatureVerifier verifier("dev-field-device-key");
    SignedBootloaderOtaUpdater ota(flash, verifier);
    OtaUpdateRequest request;
    request.version = "1.2.3";
    request.channel = "stable";
    request.artifactUri = "https://firmware.local/bems.bin";
    request.checksum = "abc123";
    request.signature = verifier.signForSimulator(request);
    assert(ota.stage(request));
    assert(ota.status().state == "staged");
    assert(ota.status().activeSlot == "A");
    assert(ota.status().stagedSlot == "B");
    assert(flash.verifyChecksum("boot-slot-B"));
    assert(ota.applyStagedImage());
    assert(ota.status().state == "pending-confirmation");
    assert(ota.status().activeSlot == "B");
    assert(!ota.status().bootConfirmed);
    assert(ota.confirmBoot());
    assert(ota.status().state == "complete");
    assert(ota.status().bootConfirmed);
    assert(ota.status().activeVersion == "1.2.3");

    OtaUpdateRequest rollbackRequest;
    rollbackRequest.version = "1.2.4";
    rollbackRequest.channel = "stable";
    rollbackRequest.artifactUri = "https://firmware.local/bems-rollback.bin";
    rollbackRequest.checksum = "def456";
    rollbackRequest.signature = verifier.signForSimulator(rollbackRequest);
    assert(ota.stage(rollbackRequest));
    assert(ota.status().stagedSlot == "A");
    assert(ota.applyStagedImage());
    assert(ota.status().activeSlot == "A");
    assert(ota.rollback());
    assert(ota.status().activeSlot == "B");

    FixedSetpointStrategy strategy(objects, setpoint, 22.5);
    BareMetalFieldDeviceApplication app(objects, flash, schedules, ota, strategy);
    app.sampleIo();
    app.runControl(1.0);
    app.publishBacnetObjects();
    app.serviceWatchdog();

    auto value = objects.readPresentValue(setpoint);
    assert(value.has_value());
    assert(value->numericValue == 22.5);

    SimulatedRadioTransport radio;
    SimulatedEia485Transport eia485;
    assert(radio.send({0x81, 0x0a}));
    assert(eia485.send({0x55, 0xaa}));
    assert(radio.medium().find("wireless") != std::string::npos);
    assert(eia485.medium().find("EIA-485") != std::string::npos);

    return 0;
}
