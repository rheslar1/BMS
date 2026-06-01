# Edge Core BACnet Integration

This module provides a C++ edge core that integrates with a BACnet C stack.
The implementation is designed to use a standard open-source BACnet stack such as:

- SourceForge BACnet Protocol Stack: https://sourceforge.net/projects/bacnet/
- https://github.com/bacnet-stack/bacnet-stack

The SourceForge project describes a portable C BACnet library that provides application, network, and MAC-layer communication services for embedded systems and operating systems. IntelliBuild Energy keeps `src/bacnet_interface.h` as the stable C-compatible seam so this stack can back the production implementation without changing `EdgeRuntime`, gRPC, Node API, or UI code.

## Structure

- `src/main.cpp` - edge application entrypoint
- `src/edge_runtime.*` - runtime facade for polling, analytics, discovery, and writeback
- `src/bacnet_client.*` - C++ adapter and `IBacnetClient` interface for the BACnet stack
- `src/device_manager.*` - device detail model and refresh logic
- `src/discovery_service.*` - BACnet device discovery abstraction
- `src/writeback_controller.*` - safe BACnet writeback strategy with clamping and rollback
- `src/hvac_control.*` - modular AHU, VAV, and chiller control strategies with PID loops
- `src/energy_ai.*` - energy prediction and optimization logic
- `src/edge_grpc_server.*` - `EdgeCoreService` gRPC server adapter
- `src/bacnet_interface.*` - C-style BACnet stack bridge
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
- `EdgeRuntime` acts as the facade for the executable entrypoint and gRPC server.

Patterns used:

- Adapter: `BacnetStackClient` and the fieldbus helpers adapt protocol-specific boundaries into C++ interfaces.
- Facade: `EdgeRuntime` and `SimulatorFieldbusGateway` expose simple orchestration surfaces over lower-level protocol details.
- Strategy: writeback mode and fieldbus gateway implementations can be swapped without changing callers.
- Dependency inversion: high-level services depend on `IBacnetClient`, `IDeviceDiscovery`, `IWritebackController`, and `IFieldbusGateway`, not concrete protocol implementations.
- Strategy pattern: AHU, VAV, and chiller automation are isolated behind `IHvacControlStrategy` so equipment sequences can evolve without changing BACnet transport or writeback safety.
- Single responsibility: BACnet encoding, fieldbus frame generation, discovery, writeback safety, gRPC transport, and energy logic are separate modules.

## Build

Use CMake to build the edge core:

```bash
mkdir -p repo/edge-core/build
cd repo/edge-core/build
cmake ..
cmake --build .
```

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
| SubscribeCOV | Change of value | Optional subscription request for BACnet object updates |

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

## Service Contract

The Node.js API and C++ gRPC server share `../proto/edge_service.proto`.
It defines health, device inventory, discovery, point read/write, and energy forecast RPCs.

At runtime the edge core starts `bems.edge.v1.EdgeCoreService` on `EDGE_GRPC_BIND`, defaulting to `0.0.0.0:50051`. Docker Compose points the Node.js API at `EDGE_GRPC_ENDPOINT=edge-core:50051`.

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
