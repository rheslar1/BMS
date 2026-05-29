# Yocto Integration

This folder contains a minimal `meta-bems` layer for Digi ConnectCore i.MX93 style builds.

## Layer Contents

- `meta-bems/conf/layer.conf`: layer registration.
- `recipes-bems/edge-core/edge-core.bb`: builds the C++ BACnet/control engine with CMake and installs a systemd service.
- `recipes-bems/node-api/node-api.bb`: packages the Node.js API under `/opt/bems/node-api`.

## Notes

The recipes expect the project source to be copied into the Yocto work directory by the platform build or converted to a Git `SRC_URI` for production.
Set `BACNET_LOCAL_IP` in the installed systemd service when the i.MX93 target should bind a specific Ethernet interface.
