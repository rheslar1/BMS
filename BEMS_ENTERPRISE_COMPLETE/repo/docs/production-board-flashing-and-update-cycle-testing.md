# Production Board Flashing and Update-Cycle Testing

This runbook validates the production edge image on physical i.MX93-class hardware and proves the SWUpdate update cycle before site rollout.

## Scope

The validation covers:

- Yocto `bems-edge-core-image` build output.
- Physical board flashing from a `wic.gz` image.
- First boot and systemd service validation.
- SWUpdate `.swu` install to the inactive A/B slot.
- Boot confirmation and rollback behavior.
- Explicit system package updates through `opkg`, `dnf`, or `apt`.
- RabbitMQ `swupdate.install` OTA command delivery from the Node API.
- BACnet ReadPropertyMultiple, COV subscription, BACnet MS/TP/EIA-485, and nRF52840 wired or wireless device smoke checks.
- Physical hardware inventory, serial adapter smoke checks, richer commissioning readiness, broader protocol smoke checks, and long-run field hardening soak plans.

## Required Equipment

- Target edge board with serial console access.
- Lab host with Yocto build output and removable media writer access.
- Network link between lab host, BEMS services, RabbitMQ, and target board.
- BACnet/IP controller or simulator, plus BACnet MS/TP/EIA-485 adapter when validating serial fieldbus.
- nRF52840 BACnet field device or bridge for wired/wireless field-device validation.
- Signed SWUpdate `.swu` image and public verification key installed at `/etc/swupdate/swupdate-public.pem`.

## Build Inputs

Build the production image with the BEMS Yocto layer and `meta-swupdate` enabled:

```bash
MACHINE=edge-core bitbake bems-edge-core-image
```

Expected artifacts:

- `bems-edge-core-image-edge-core.wic.gz`
- Signed SWUpdate `.swu` update package.
- Optional SHA-256 checksum for the `.swu` package.

## Harness

Use `scripts/production_board_flash_update_test.sh` for repeatable lab execution.

Preflight:

```bash
scripts/production_board_flash_update_test.sh preflight
```

Flash removable media. This is intentionally guarded:

```bash
IMAGE_WIC_GZ=/path/to/bems-edge-core-image-edge-core.wic.gz \
FLASH_TARGET_DEVICE=/dev/sdX \
FLASH_CONFIRM=YES_FLASH_TARGET \
scripts/production_board_flash_update_test.sh flash-media
```

First boot validation:

```bash
BOARD_HOST=192.0.2.50 \
BOARD_USER=root \
scripts/production_board_flash_update_test.sh validate-boot
```

Hardware inventory:

```bash
BOARD_HOST=192.0.2.50 \
BOARD_USER=root \
scripts/production_board_flash_update_test.sh hardware-inventory
```

## Update-Cycle Test

Install a signed SWUpdate image:

```bash
BOARD_HOST=192.0.2.50 \
BOARD_USER=root \
SWU_IMAGE=/path/to/bems-edge-core-update.swu \
SWU_SHA256=<sha256> \
scripts/production_board_flash_update_test.sh ota-install
```

After reboot, rerun:

```bash
BOARD_HOST=192.0.2.50 \
BOARD_USER=root \
scripts/production_board_flash_update_test.sh validate-boot
```

Acceptance criteria:

- `bems-edge-core.service` is enabled and active.
- `swupdate --version` works on the target.
- `/usr/bin/bems-swupdate-client` exists and is executable.
- `/usr/lib/swupdate/bems-system-package-update.sh` exists and is executable.
- The new version is active after reboot.
- Persistent setpoints and BACnet device-resident schedules remain present.
- The previous slot remains available for rollback until boot confirmation.

## Rollback Test

Use a controlled bad update image or disable boot confirmation according to the board bootloader policy. The expected behavior is:

- SWUpdate stages the inactive slot.
- The board attempts the pending slot.
- Watchdog or boot-confirm timeout rejects the pending slot.
- Bootloader returns to the previous confirmed slot.
- BEMS OTA job state reports `rollback` or a failure state with the previous version still active.

Do not run rollback testing on a production occupant-facing controller without a serial console, local power control, and a known-good recovery image.

## System Package Update Test

System package updates are explicit and signed as part of the OTA manifest. They can also be validated directly on a lab board:

```bash
BOARD_HOST=192.0.2.50 \
BOARD_USER=root \
SYSTEM_PACKAGES="edge-core node-api" \
PACKAGE_MANAGER=opkg \
scripts/production_board_flash_update_test.sh package-update
```

Acceptance criteria:

- Package manager metadata refresh succeeds.
- Only the listed packages are installed or upgraded.
- `bems-edge-core.service` remains active after the package update and reboot.

## RabbitMQ OTA Command Test

Queue the update from the Node API so the production event-driven path is exercised:

```bash
API_BASE_URL=http://localhost:3000 \
SESSION_TOKEN=<session-token> \
DEVICE_ID=1 \
ARTIFACT_ID=1 \
scripts/production_board_flash_update_test.sh rabbitmq-ota-command
```

Acceptance criteria:

- API returns HTTP 202 with an OTA job id.
- `firmware_update_jobs` records the queued job.
- RabbitMQ receives command type `swupdate.install`.
- Target board consumes the command and runs `/usr/bin/bems-swupdate-client`.
- OTA status progresses from `queued` to install/complete or rollback.

## BACnet and nRF52840 Smoke Tests

BACnet ReadPropertyMultiple and COV:

```bash
API_BASE_URL=http://localhost:3000 \
SESSION_TOKEN=<session-token> \
BACNET_DEVICE_INSTANCE=1001 \
BACNET_OBJECT_TYPE=analogInput \
BACNET_OBJECT_INSTANCE=1 \
scripts/production_board_flash_update_test.sh bacnet-smoke
```

nRF52840 BACnet metadata:

```bash
API_BASE_URL=http://localhost:3000 \
SESSION_TOKEN=<session-token> \
NRF52840_DEVICE_ID=12 \
scripts/production_board_flash_update_test.sh nrf52840-smoke
```

Acceptance criteria:

- BACnet batch read request queues `bacnet.read_property_multiple`.
- COV subscription request queues `bacnet.subscribe_cov`.
- BACnet MS/TP/EIA-485 and Modbus RTU serial adapter paths are checked with the site serial adapter connected through `serial-adapter-smoke`.
- nRF52840 device metadata includes BACnet identity, transport, firmware, and battery percentage.

## Commissioning, Protocol, and Hardening Checks

```bash
API_BASE_URL=http://localhost:3000 \
SESSION_TOKEN=<session-token> \
scripts/production_board_flash_update_test.sh commissioning-readiness
```

```bash
API_BASE_URL=http://localhost:3000 \
SESSION_TOKEN=<session-token> \
PROTOCOL=knx-ip \
scripts/production_board_flash_update_test.sh protocol-smoke
```

```bash
API_BASE_URL=http://localhost:3000 \
SESSION_TOKEN=<session-token> \
HARDENING_PROFILE=site-acceptance-7d \
scripts/production_board_flash_update_test.sh hardening-soak
```

Acceptance criteria:

- Commissioning readiness returns device checklists and `readyForAcceptance` totals.
- Protocol smoke tests return normalized command metadata for BACnet, Modbus, CAN, KNX/IP, DALI-2, LonWorks, OPC UA, SNMP, REST, or MQTT.
- Hardening soak plan includes watchdog, metrics, commissioning, protocol, and OTA evidence collection.

## Production Sign-Off

Record these before release:

- Yocto build id and Git commit.
- Image SHA-256 and `.swu` SHA-256.
- Board model, bootloader version, and storage device.
- Active and inactive A/B slot before and after update.
- SWUpdate log excerpt.
- RabbitMQ command id and OTA job id.
- BACnet device instances tested.
- nRF52840 wired/wireless transports tested.
- Physical hardware validation report completed.
- Commissioning readiness and protocol smoke-test evidence.
- Long-run field hardening soak result.
- Rollback result.
- Operator approving production rollout.
