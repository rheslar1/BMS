# Edge Core BACnet Integration

This module provides a C++ edge core that integrates with a BACnet C stack.
The implementation is designed to use a standard open-source BACnet stack such as:

- SourceForge BACnet Protocol Stack: https://sourceforge.net/projects/bacnet/
- https://github.com/bacnet-stack/bacnet-stack

The SourceForge project describes a portable C BACnet library that provides application, network, and MAC-layer communication services for embedded systems and operating systems. IntelliBuild Energy keeps `src/bacnet_interface.h` as the stable C-compatible seam so this stack can back the production implementation without changing `EdgeRuntime`, RabbitMQ edge orchestration, Node API, or UI code.

## Structure

- `src/main.cpp` - edge application entrypoint
- `src/edge_runtime.*` - runtime facade for polling, analytics, discovery, and writeback
- `src/bacnet_client.*` - C++ adapter and `IBacnetClient` interface for the BACnet stack
- `src/device_manager.*` - device detail model and refresh logic
- `src/discovery_service.*` - BACnet device discovery abstraction
- `src/writeback_controller.*` - safe BACnet writeback strategy with clamping and rollback
- `src/hvac_control.*` - modular AHU, VAV, and chiller control strategies with PID loops
- `src/energy_ai.*` - energy prediction and optimization logic
- `src/bacnet_interface.*` - C-style BACnet stack bridge
- `src/bacnet_object_database.*` - BACnet server/device object database
- `src/modbus_rtu_interface.*` - Modbus RTU frame encoding and simulator helpers
- `src/canbus_interface.*` - classic CAN frame validation and simulator helpers
- `src/fieldbus_gateway.*` - SOLID fieldbus facade for Modbus RTU and CAN bus adapters

## Design Principles

The core uses small interfaces to keep hardware and protocol code replaceable:

- `IBacnetClient` applies dependency inversion for BACnet read/write/discovery operations.
- `BacnetStackClient` adapts the C-style stack boundary to C++ services.
- `IDeviceDiscovery` separates commissioning discovery from runtime polling.
- `IWritebackController` isolates write safety rules from device management.
- `IFieldbusGateway` isolates Modbus RTU and CAN bus command handling from runtime orchestration.
- `EdgeRuntime` acts as the facade for the executable entrypoint and RabbitMQ command orchestration.

Patterns used:

- Adapter: `BacnetStackClient` and the fieldbus helpers adapt protocol-specific boundaries into C++ interfaces.
- Facade: `EdgeRuntime` and `SimulatorFieldbusGateway` expose simple orchestration surfaces over lower-level protocol details.
- Strategy: writeback mode and fieldbus gateway implementations can be swapped without changing callers.
- Dependency inversion: high-level services depend on `IBacnetClient`, `IDeviceDiscovery`, `IWritebackController`, and `IFieldbusGateway`, not concrete protocol implementations.
- Strategy pattern: AHU, VAV, and chiller automation are isolated behind `IHvacControlStrategy` so equipment sequences can evolve without changing BACnet transport or writeback safety.
- Single responsibility: BACnet encoding, BACnet object database, fieldbus frame generation, discovery, writeback safety, RabbitMQ command transport, and energy logic are separate modules.

## Build

Use CMake to build the edge core:

```bash
mkdir -p repo/edge-core/build
cd repo/edge-core/build
cmake ..
cmake --build .
```

Useful CMake presets:

- `default`: normal C++17 build.
- `asan-ubsan`: AddressSanitizer and UndefinedBehaviorSanitizer debug build.
- `tsan`: ThreadSanitizer debug build for threaded tests.
- `static-analysis`: enables `clang-tidy` through CMake.

Static-analysis exceptions are tracked in `cppcheck-suppressions.txt`. Add suppressions there rather than hiding them in CI commands.

## BACnet Integration

`src/bacnet_interface.cpp` contains the BACnet/IP network boundary used by the edge core.
It opens a UDP BACnet/IP socket, performs targeted Who-Is/I-Am discovery, sends confirmed ReadProperty requests, sends confirmed WriteProperty requests for present-value writes, and supports SubscribeCOV requests.
The rest of the edge core does not need to change as long as `bacnet_interface.h` keeps the same C-compatible functions.

Production integration path:

1. Vendor/import the SourceForge BACnet Protocol Stack in the edge-core build or Yocto recipe.
2. Replace the current local BACnet packet helpers inside `src/bacnet_interface.cpp` with stack calls for initialization, datalink binding, Who-Is/I-Am, ReadProperty, WriteProperty, SubscribeCOV, and COV notification dispatch.
3. Keep the existing `bacnet_initialize`, `bacnet_discover_device`, `bacnet_read_property`, `bacnet_write_property`, and `bacnet_subscribe_cov` C functions stable.
4. Keep `BACNET_SIMULATOR_ENABLED=true` available for CI and demos, while production i.MX93 deployments run with the simulator disabled.

BACnet/IP services used by the edge core:

| Service | Purpose | Edge-core usage |
| --- | --- | --- |
| Who-Is | Discover devices | Broadcast or targeted discovery by device instance range |
| I-Am | Discovery response | Parsed to build reachable BACnet device inventory |
| ReadProperty | Read value | Reads `present-value` from analog, binary, and schedule objects |
| WriteProperty | Send command | Writes `present-value` through the safe writeback path |
| ReadPropertyMultiple | Batch read values | Same-device batch reads for `present-value` points |
| SubscribeCOV | Change of value | Optional subscription request for BACnet object updates |
| ConfirmedCOVNotification | Change event | Notification parsing and ACK handling |
| UnconfirmedCOVNotification | Change event | Notification parsing |

Set `BACNET_LOCAL_IP` when the edge device must bind a specific interface. If it is not set, the edge core binds `0.0.0.0` and uses BACnet/IP broadcast discovery on UDP port `47808`.

For local demos, CI, and development without field equipment, enable the built-in simulator:

```bash
BACNET_SIMULATOR_ENABLED=true
```

The simulator exposes device instances `101`, `102`, `103`, `201`, `250`, `301`, and `302` through the same discovery, ReadProperty, WriteProperty, and SubscribeCOV functions used by the real BACnet path. Docker Compose enables this by default; the embedded systemd service defaults it to `false`.

## Fieldbus Adapters

The edge core also includes modular fieldbus support for equipment commonly found beside BACnet controllers:

- Modbus RTU over RS-485 for meters, VFDs, breakers, and legacy equipment
- CAN bus for local appliance, drive, or embedded controller integration

`IFieldbusGateway` is the runtime boundary. The current `SimulatorFieldbusGateway` validates and builds protocol frames for development and CI. Production serial or SocketCAN transports can implement the same interface without changing the rest of the edge core.

Module tests are provided in `tests/fieldbus_interface_test.cpp` for Modbus CRC/frame encoding, simulated Modbus register reads, CAN frame validation, and the fieldbus gateway facade.

## Runtime Container Notes

- Discovery batches reserve one slot per requested BACnet instance in the requested range, then sort discovered devices by BACnet instance with `std::sort` before assigning runtime IDs.
- Polling telemetry batches are capped at `EdgeRuntime::MaxTelemetryBatchSize` entries. The current cap is 256 refreshed device snapshots per polling pass.
- Callback work passed to `EdgeRuntime::startPolling()` runs on the worker thread after each `pollOnce()` completes.
- `DeviceManager::devices_` is a `std::vector`; references and iterators can be invalidated by future insert/erase/reallocation. Runtime polling avoids keeping iterators across mutation points and copies refreshed devices into the bounded telemetry batch before sorting/logging.
- `deviceAddresses` in the BACnet bridge is a `std::map`; iterators remain stable across inserts but are invalidated for erased entries. Shutdown clears the map only after the socket is closed.

## Service API Compatibility

`src/edge_service.h` is the public service-module boundary. It uses the Pimpl pattern: callers see `EdgeService`, `EdgeServiceConfig`, and schema-bearing telemetry config records, while private runtime objects such as `EdgeRuntime`, `DeviceManager`, loggers, discovery services, and writeback controllers stay in `edge_service.cpp`.

Compatibility expectations:

- `EdgeServiceConfig::schemaVersion` and `TelemetryPointConfig::schemaVersion` start at `1`; new optional fields should preserve backward-compatible defaults.
- Private implementation members may change without requiring consumers to rebuild against a different object layout.
- Public constructor and method signatures should remain source-compatible within a major service schema version.
- The shared library target is `edge-core-service-shared`, producing `libedge-core-service.so` on Linux.

## Edge Command Contract

The Node.js API queues edge commands through RabbitMQ AMQP on `bems.edge.commands`.

Supported edge command types include `bacnet.discover_devices`, `bacnet.read_property`, `bacnet.read_property_multiple`, `bacnet.write_property`, `bacnet.subscribe_cov`, `edge.energy_forecast`, and `nrf52840.ota_update`. Authoritative reads and COV updates return through telemetry, provisioning, and event streams rather than synchronous edge RPCs.

## i.MX93 Deployment

The Yocto integration layer lives in `../yocto/meta-bems`.
It includes an `edge-core` recipe and installs `packaging/bems-edge-core.service` as a systemd unit for the target image.

## Full BACnet Stack Features

The edge core is designed to support a full BACnet feature set, including:

- BACnet configuration and client management
- BACnet IO with read/write support
- BACnet writeback with delta/absolute modes, clamping, verification, and rollback
- BACnet discovery using Who-Is / I-Am style device instance scanning
- BACnet point discovery via objectList and heuristics
- VAV discovery with AHU → VAV mapping
- Zone discovery with VAV → Zone mapping

## Device Details

The edge core manages detailed BACnet device metadata including:
- device instance
- object type
- IP address
- vendor and model
- present value and status
