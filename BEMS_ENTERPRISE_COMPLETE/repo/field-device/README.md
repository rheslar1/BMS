# BACnet Bare-Metal Field Device C++ Design

Field-device firmware is modeled as C++ bare-metal firmware. The design follows SOLID principles and keeps protocol, storage, control, schedules, and OTA update responsibilities behind small interfaces.

The directory is a buildable firmware/simulator target:

```bash
cmake -S field-device -B field-device/build
cmake --build field-device/build
ctest --test-dir field-device/build --output-on-failure
```

Design patterns used:

- Strategy: `IControlStrategy` lets AHU, VAV, meter, room sensor, or nRF52840 control behavior vary independently.
- Adapter: hardware drivers and BACnet stack bindings adapt into `IBacnetObjectTable`.
- Repository: `IScheduleRepository` stores device-resident BACnet schedules.
- Facade: `IFieldDeviceApplication` coordinates IO sampling, control, BACnet publication, watchdog service, and OTA service.
- Dependency inversion: application logic depends on interfaces, not concrete EEPROM, radio, EIA-485, BACnet, or bootloader drivers.

SOLID mapping:

- Single responsibility: object table, persistent store, schedule repository, OTA updater, and control strategy are separate contracts.
- Open/closed: new hardware, meters, sensors, and control sequences can be added by implementing interfaces.
- Liskov substitution: test doubles and production drivers implement the same contracts.
- Interface segregation: storage, BACnet object access, schedule persistence, OTA update, and control are not bundled together.
- Dependency inversion: `BareMetalFieldDeviceApplication` receives abstractions by reference.

Concrete simulator-backed implementations are in `src/simulated_drivers.cpp`:

- `SimulatedFlashStore` for EEPROM/Flash-style persistent storage and checksum validation.
- `SimulatedBacnetObjectTable` for BACnet object reads/writes.
- `SimulatedRadioTransport` for nRF52840 wireless field transport.
- `SimulatedEia485Transport` for wired BACnet/EIA-485 field transport.
- `SignedBootloaderOtaUpdater` for signed manifest validation, staged bootloader application, and rollback state.

The header in `include/field_device_firmware.h` is the firmware-side design contract reflected by `docs/device-architecture.md`, and `tests/field_device_simulator_test.cpp` exercises the simulator harness.
