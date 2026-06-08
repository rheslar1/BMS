# Physical Hardware Validation

This document defines the evidence required before a physical BEMS edge deployment is accepted for production use.

## Required Hardware Evidence

Record these items for each target board:

- Board model, serial number, CPU, RAM, storage, and bootloader version.
- Yocto image name, Git commit, image SHA-256, and `.swu` SHA-256.
- Active and inactive A/B partition identifiers.
- Network interface used for BACnet/IP and management traffic.
- EIA-485 adapter model, serial device path, baud rate, parity, and termination state.
- nRF52840 device or bridge identity, transport, firmware, and battery percentage.
- BACnet/IP device instance and object list used for validation.
- Modbus RTU slave/register map used for validation.
- RabbitMQ broker endpoint used for `swupdate.install`.

## Validation Checklist

The production validation must prove:

- The flashed Yocto image boots on the target board.
- `bems-edge-core.service` is enabled and active.
- SWUpdate is installed and can apply a signed `.swu` package.
- A/B rollback behavior is demonstrated with a controlled failure.
- Explicit system package updates succeed through the selected package manager.
- RabbitMQ `swupdate.install` reaches the target update client.
- BACnet/IP ReadPropertyMultiple and COV subscription paths work.
- BACnet MS/TP over EIA-485 read/write frames reach the serial adapter path.
- Modbus RTU over EIA-485 read/write frames reach the serial adapter path.
- nRF52840 BACnet device metadata and battery percentage are visible through the BEMS.
- Device-resident schedules and retained setpoints survive reboot/update.
- Watchdog, metrics, alarms, reports, and field-hardening soak checks remain stable through the validation window.

## Harness Actions

Use `scripts/production_board_flash_update_test.sh`:

- `hardware-inventory`
- `serial-adapter-smoke`
- `validate-boot`
- `ota-install`
- `package-update`
- `rabbitmq-ota-command`
- `bacnet-smoke`
- `nrf52840-smoke`
- `commissioning-readiness`
- `protocol-smoke`
- `hardening-soak`
- `full-cycle`

## Sign-Off Template

```text
Site:
Board model:
Board serial:
Image:
Image SHA-256:
SWUpdate package:
SWUpdate SHA-256:
Active slot before:
Active slot after:
Rollback result:
BACnet/IP device tested:
BACnet MS/TP adapter:
Modbus RTU device tested:
nRF52840 device tested:
Commissioning readiness result:
Field hardening profile:
Validation operator:
Approval date:
Notes:
```
