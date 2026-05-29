# Edge Core BACnet Integration

This module provides a C++ edge core that integrates with a BACnet C stack.
The implementation is designed to use a standard open-source BACnet stack such as:

- https://github.com/bacnet-stack/bacnet-stack

## Structure

- `src/main.cpp` - edge application entrypoint
- `src/edge_runtime.*` - runtime facade for polling, analytics, discovery, and writeback
- `src/bacnet_client.*` - C++ adapter and `IBacnetClient` interface for the BACnet stack
- `src/device_manager.*` - device detail model and refresh logic
- `src/discovery_service.*` - BACnet device discovery abstraction
- `src/writeback_controller.*` - safe BACnet writeback strategy with clamping and rollback
- `src/energy_ai.*` - energy prediction and optimization logic
- `src/bacnet_interface.*` - C-style BACnet stack bridge

## Design Principles

The core uses small interfaces to keep hardware and protocol code replaceable:

- `IBacnetClient` applies dependency inversion for BACnet read/write/discovery operations.
- `BacnetStackClient` adapts the C-style stack boundary to C++ services.
- `IDeviceDiscovery` separates commissioning discovery from runtime polling.
- `IWritebackController` isolates write safety rules from device management.
- `EdgeRuntime` acts as the facade for the executable entrypoint and future gRPC server.

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
It opens a UDP BACnet/IP socket, performs targeted Who-Is/I-Am discovery, sends confirmed ReadProperty requests, and sends confirmed WriteProperty requests for present-value writes.
The rest of the edge core does not need to change as long as `bacnet_interface.h` keeps the same C-compatible functions.

Set `BACNET_LOCAL_IP` when the edge device must bind a specific interface. If it is not set, the edge core binds `0.0.0.0` and uses BACnet/IP broadcast discovery on UDP port `47808`.

## Service Contract

The Node.js API and future C++ gRPC server share `../proto/edge_service.proto`.
It defines health, device inventory, discovery, point read/write, and energy forecast RPCs.

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
