# IntelliBuild Energy Device Architecture

## Purpose

This document defines the field-device architecture for IntelliBuild Energy. Field controllers are BACnet bare-metal devices, and nRF52840 devices are BACnet devices with bare-metal C++ firmware. All field devices expose telemetry, command, and configuration data to the BEMS through BACnet objects, gateway adapters, or meter protocol profiles.

## Device Runtime Profile

Target BACnet bare-metal C++ controller firmware:

- bare metal scheduler and task model
- Hardware abstraction layer for sensors, actuators, meters, radio, nonvolatile storage, and watchdog
- BACnet object table or gateway-normalized object table
- Local control task for safe device behavior during network loss
- Communication task for BACnet/IP, BACnet MS/TP gateway, Modbus, REST, wireless gateway, or meter protocol transport
- EEPROM/nonvolatile configuration task for retained setpoints, calibration, identity, and commissioning state

The firmware must keep critical local behavior independent from the cloud and supervisory UI. Network services publish telemetry and accept approved commands, but last-known safe setpoints and device protection limits remain local.

nRF52840 BACnet devices use the same bare-metal firmware model. They need firmware that exposes the required BACnet device/object identity, local IO behavior, retained configuration, and wireless or wired transport.


Recommended process responsibilities:

- `Sensor/IO process`: samples analog, binary, pulse, meter, or wireless values.
- `Control process`: applies local setpoints, limits, safeties, and fallback states.
- `Protocol process`: maps local values into BACnet objects, Modbus registers, REST resources, or wireless gateway payloads.
- `Event/Telemetry Queue`: buffers change events, alarms, and command acknowledgements.
- `EEPROM Configuration process`: persists commissioning identity, setpoints, min/max ranges, pulse settings, and calibration data.
- `Watchdog/Health process`: supervises task heartbeats, brownout recovery, and protocol availability.
- `OTA Update process`: validates signed firmware metadata, stages the image, flips the boot slot, and reports update status through BACnet-visible metadata.

## C++ Design Patterns and SOLID Principles

Field-device firmware uses C++ interfaces and small classes so bare-metal hardware drivers can change without changing BACnet object behavior. The firmware-side design contract is captured in `field-device/include/field_device_firmware.h`, and the buildable target is defined by `field-device/CMakeLists.txt`.

Design patterns:

- Strategy: `IControlStrategy` isolates AHU, VAV, room sensor, meter, and nRF52840 control behavior.
- Adapter: BACnet stack bindings, radio drivers, EIA-485 drivers, EEPROM, Flash NVS, FRAM, and bootloader drivers adapt into narrow interfaces.
- Repository: `IScheduleRepository` persists BACnet Schedule objects on the device.
- Facade: `IFieldDeviceApplication` coordinates IO sampling, control, BACnet object publication, watchdog service, and OTA update.
- Dependency injection: `BareMetalFieldDeviceApplication` receives `IBacnetObjectTable`, `IPersistentStore`, `IScheduleRepository`, `IOtaUpdater`, and `IControlStrategy` abstractions.

SOLID requirements:

- Single responsibility: BACnet object table, persistent storage, schedule storage, OTA update, and control strategy stay separate.
- Open/closed: new sensors, meters, transports, and control sequences are added through new implementations of existing interfaces.
- Liskov substitution: simulator, test double, and production hardware implementations satisfy the same contracts.
- Interface segregation: BACnet object access, schedule persistence, OTA update, storage, and control are separate interfaces.
- Dependency inversion: application logic depends on abstractions, not concrete hardware or protocol drivers.

Buildable firmware/simulator target:

- `field-device/src/field_device_firmware.cpp`: application facade implementation.
- `field-device/src/simulated_drivers.cpp`: concrete simulator implementations for EEPROM/Flash persistent storage, BACnet object table, nRF52840 wireless transport, EIA-485 transport, signed OTA bootloader flow, and fixed setpoint control.
- `field-device/src/main.cpp`: firmware simulator executable.
- `field-device/tests/field_device_simulator_test.cpp`: unit/simulator harness for storage, schedules, BACnet read/write, radio/EIA-485 transport, OTA staging/application, and control strategy behavior.

## Normalized Device Object Model

Each device exposes or is normalized into:

```text
Device Identity
  -> device instance / address / transport id
  -> vendor, model, firmware, hardware profile
  -> object type and object instance
  -> present-value
  -> units, status, reliability
  -> configuration metadata
```

Supported normalized object types:

- `analogInput`
- `analogOutput`
- `analogValue`
- `binaryInput`
- `binaryOutput`
- `binaryValue`
- `schedule`

Wireless, wired, and meter payloads are represented in this same object model so dashboards, alarms, trends, AI optimization, and writeback can treat devices consistently.

## Device Persistent Storage

Field devices use persistent storage for schedules, identity, commissioning state, calibration, counters, pulse totals, min/max ranges, and retained setpoints. Supported media include EEPROM, Flash NVS, FRAM, or a small filesystem-backed configuration partition.

Setpoint-capable devices store retained setpoint state in EEPROM or equivalent nonvolatile memory. Device schedules persist on the BACnet device as Schedule objects so local schedule execution survives server or network loss. The BEMS stores matching metadata in each device `configuration` JSON:

```json
{
  "eepromEnabled": true,
  "eepromAddress": "0x0100",
  "eepromSizeBytes": 256,
  "eepromWritePolicy": "on_change",
  "persistentStorage": {
    "enabled": true,
    "medium": "EEPROM",
    "namespace": "device_config",
    "wearLeveling": true,
    "retainedKeys": ["identity", "commissioning", "setpoint", "schedule", "range", "calibration", "counters"]
  },
  "bacnetScheduleStorage": {
    "enabled": true,
    "persistentOnDevice": true,
    "objectType": "schedule",
    "storagePolicy": "device_resident",
    "writePath": "BACnet WriteProperty to the device Schedule object",
    "scheduleCount": 1
  },
  "setpointStorage": {
    "address": "0x0100",
    "sizeBytes": 256,
    "writePolicy": "on_change",
    "retainedSetpoint": 22.0,
    "checksum": "crc16"
  }
}
```

Write policies:

- `on_change`: persist after an approved setpoint change.
- `on_schedule`: persist when a scheduled control window applies or a BACnet Schedule object changes.
- `manual`: persist only when an operator saves configuration.
- `disabled`: do not retain setpoint in EEPROM.

The device should validate persistent data with a checksum and fall back to min/max bounded defaults if storage is corrupt or blank. Flash-backed implementations should use wear-leveling or bounded write rates for frequently changing values.

For device-scoped schedules, the BACnet device is the runnable source. The server stores a management/audit copy and mirrors create, update, enable, disable, and delete operations to the device-resident Schedule object metadata.

## OTA Update

BACnet bare-metal field devices support OTA firmware update orchestration. The BEMS queues the update intent, records the target version/channel/artifact URI, and the field device supervisor applies the image through a safe bootloader flow.

Required OTA behavior:

- Signed firmware metadata with version, channel, artifact URI, checksum, signature, signing key id, and manifest algorithm.
- A/B boot partitions with an active slot, inactive staging slot, boot-control block, watchdog-confirmed boot, and rollback to the previous confirmed slot.
- BACnet-visible update status such as `queued`, `downloading`, `staged`, `applying`, `complete`, or `rollback`.
- Persistent OTA state in EEPROM/Flash NVS so power loss during update resumes safely.
- Local control and schedule execution remain active until the bootloader applies the staged image.
- Device schedules and setpoints must survive the firmware update.
- Server-side firmware artifacts are created through `POST /api/firmware/artifacts`; device jobs are queued through `POST /api/devices/:deviceId/ota-update`; job status is listed through `GET /api/firmware/ota-jobs`.

The field-device implementation models this as slots `A` and `B`. OTA staging always writes to the inactive slot, `applyStagedImage()` swaps the active slot into `pending-confirmation`, `confirmBoot()` marks the new slot as confirmed, and `rollback()` restores the previous confirmed slot if watchdog confirmation does not arrive.

## Device Classes

### BACnet BARE METAL Controllers

BACnet-capable BARE METAL controllers expose local objects directly over BACnet/IP or through routed BACnet MS/TP. These devices support telemetry reads, command writes, and optional COV notifications.

Typical objects:

- Temperature sensor: `analogInput`
- Damper or valve command: `analogOutput`
- Fan command: `binaryOutput`
- Schedule: `schedule`

### nRF52840 BACnet Devices

nRF52840 devices are BACnet devices with bare-metal firmware. They expose BACnet object identity directly and may use either wireless or wired field transport. Supported wireless paths include BLE, Thread, and IEEE 802.15.4 bridge hardware. Supported wired paths include BACnet MS/TP or EIA-485 adapter hardware.

Typical payloads:

- Temperature, humidity, CO2, pressure, and occupancy
- Optional battery percentage
- Firmware and transport profile
- BACnet device instance and object identity
- Commissioning state

Normalized examples:

- Room temperature -> `analogInput`
- Occupancy -> `binaryInput`

### Field-Selectable Power Meters

Power meters use a 5-in-1 field-selectable communication profile:

- BACnet/IP
- BACnet/IPv6
- Modbus TCP
- Modbus RTU over EIA-485
- REST API

The meter may connect over EIA-485 serial wiring or Ethernet. It also provides one configurable pulse output and two configurable pulse inputs for external utility pulses or totalizers.

Normalized examples:

- Demand kW -> `analogValue`
- Energy kWh -> `analogValue`
- Pulse input totalizer -> `analogInput`
- Pulse output state -> `binaryValue`

## Device-to-Platform Flow

```text
Field Device
  -> BACnet/Modbus/REST/Wireless or Wired Gateway
  -> C++ Edge Core or Node API adapter
  -> Normalized Device Model
  -> MySQL configuration/trends/alarms
  -> SSE dashboard and Kafka/RabbitMQ/MQTT event streams
```

## Offline Behavior

Devices must continue local control when the supervisory network is unavailable:

- Keep the last valid retained setpoint.
- Keep the last valid device-resident BACnet schedule.
- Enforce min/max range limits.
- Continue safety interlocks and local alarm detection.
- Buffer or expose the latest present value when communication returns.
- Reject unsafe writeback values outside configured bounds.

## Commissioning Checklist

- Assign device instance, object type, and object instance.
- Verify bare-metal watchdog and protocol process health for BACnet field devices.
- Verify nRF52840 BACnet object identity and wired/wireless transport profile.
- Confirm EEPROM retained setpoint read/write.
- Confirm BACnet Schedule object persistence on the device.
- Confirm OTA update metadata, signature/checksum validation, rollback state, and schedule retention.
- Confirm battery percentage reporting for battery-backed BACnet devices.
- Validate min/max setpoint limits.
- Confirm BACnet/Modbus/REST/wireless gateway mapping.
- Confirm pulse input/output configuration for meters.
- Verify dashboard digital twin placement and alarm/trend visibility.
