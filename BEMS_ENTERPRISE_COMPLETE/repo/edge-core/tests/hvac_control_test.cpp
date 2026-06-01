#include "hvac_control.h"

#include <cassert>
#include <string>

void testVavCoolingDemandOpensDamper() {
    HvacControlEngine engine;
    const auto output = engine.evaluate({
        "VAV",
        "North VAV",
        25.0,
        22.0,
        13.0,
        13.0,
        42.0,
        55.0,
        7.0,
        7.0,
        true,
        false,
        true,
        60.0,
    });

    assert(output.equipmentType == "VAV");
    assert(output.mode == "occupied_zone_temperature_control");
    assert(output.damperCommand > 0.0);
    assert(output.fanCommand == 100.0);
}

void testDemandResponseBiasesSetpoint() {
    HvacControlEngine engine;
    const auto output = engine.evaluate({
        "Chiller",
        "Plant Chiller",
        22.0,
        22.0,
        13.0,
        13.0,
        80.0,
        80.0,
        9.0,
        7.0,
        true,
        true,
        true,
        60.0,
    });

    assert(output.equipmentType == "Chiller");
    assert(output.mode == "demand_response_chilled_water_reset");
    assert(output.setpointBias > 0.0);
}

void testUnsupportedEquipmentRaisesAlarm() {
    HvacControlEngine engine;
    const auto output = engine.evaluate({"Boiler", "Legacy Boiler"});

    assert(output.mode == "unsupported");
    assert(output.alarm);
}

int main() {
    testVavCoolingDemandOpensDamper();
    testDemandResponseBiasesSetpoint();
    testUnsupportedEquipmentRaisesAlarm();
    return 0;
}
