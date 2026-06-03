# Yocto Integration

This folder contains a minimal `meta-bems` layer for Digi ConnectCore i.MX93 style builds and the generic BEMS edge-core machine profile.

## Layer Contents

- `meta-bems/conf/layer.conf`: layer registration.
- `meta-bems/conf/machine/edge-core.conf`: `MACHINE=edge-core` ARM64 machine profile for the BACnet/RabbitMQ edge runtime.
- `recipes-bems/images/bems-edge-core-image.bb`: graphical image derived from `core-image-sato` with BEMS edge packages installed.
- `recipes-bems/edge-core/edge-core.bb`: builds the C++ BACnet/control edge runtime with CMake and installs a systemd service.
- `recipes-bems/node-api/node-api.bb`: packages the Node.js API under `/opt/bems/node-api`.

## Machine

Use the edge-core machine profile with:

```bash
MACHINE=edge-core bitbake bems-edge-core-image
```

The machine profile targets ARM64 Cortex-A55 class hardware, enables Ethernet/USB/serial/wireless features, and emits `wic.gz` plus `tar.bz2` artifacts. The `bems-edge-core-image` recipe derives from `core-image-sato` and installs the `edge-core` and `node-api` packages.

## Notes

The recipes expect the project source to be copied into the Yocto work directory by the platform build or converted to a Git `SRC_URI` for production.
Set `BACNET_LOCAL_IP` in the installed systemd service when the i.MX93 target should bind a specific Ethernet interface.
Edge orchestration is RabbitMQ AMQP-first. The Node API queues edge commands with `EDGE_COMMAND_TRANSPORT=rabbitmq` and `RABBITMQ_URL`; the C++ edge-core service owns BACnet/IP runtime behavior and installs as `bems-edge-core.service`.
