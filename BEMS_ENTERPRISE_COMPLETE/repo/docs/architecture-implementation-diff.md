# Architecture Implementation Diff

This document compares `docs/architecture.md` with the current repository implementation. It is the design-completion traceability record used to show what changed, what is implemented, and what remains as physical validation.

## Overall Status

The software design is complete against `docs/architecture.md` and is enforced by `scripts/verify_architecture.sh`.

Residual items are not software design gaps:

- BACnet BTL certification requires formal vendor test lab execution.
- Yocto image flashing requires physical target hardware.
- SWUpdate A/B rollback proof requires the target bootloader and storage layout.
- nRF52840 wireless/wired behavior requires physical radio or serial hardware.

## Architecture Delta

| Architecture area | `architecture.md` requirement | Implementation evidence | Delta |
| --- | --- | --- | --- |
| Event-driven runtime | Kafka for backend events, RabbitMQ for edge commands, MQTT for cloud bridge, SSE for browser projection | `node-api/eventBus.js`, `node-api/edgeClient.js`, `GET /api/events/status`, `GET /api/telemetry/stream`, `docker/docker-compose.yml` | No software gap |
| Edge command transport | RabbitMQ AMQP edge command queue with no direct RPC service path from Node to edge | `node-api/edgeClient.js`, `GET /api/edge/command-transport`, `edge-core/src/main.cpp`, stale direct-RPC markers blocked by verifier | No software gap |
| BACnet services | Who-Is/I-Am, ReadProperty, ReadPropertyMultiple, WriteProperty, SubscribeCOV, ConfirmedCOVNotification/UnconfirmedCOVNotification | `edge-core/src/bacnet_interface.cpp`, `edge-core/tests/bacnet_simulator_test.cpp`, `POST /api/edge/read-points-batch`, `POST /api/edge/cov-notifications` | Formal BACnet conformance still requires lab certification |
| BACnet server object database | Full device/object database with object metadata, priority array, object list, service metadata, schedules | `edge-core/src/bacnet_object_database.cpp`, `edge-core/src/bacnet_object_database.h`, `edge-core/tests/bacnet_object_database_test.cpp` | No software gap |
| Serial adapter | EIA-485 BACnet MS/TP read/write adapter path | `edge-core/src/fieldbus_gateway.cpp`, `edge-core/tests/fieldbus_interface_test.cpp`, `POST /api/bacnet/mstp/read`, `POST /api/bacnet/mstp/write` | Physical serial adapter validation required |
| Field devices | BACnet bare-metal C++ field-device firmware model with no operating-system scheduler dependency | `field-device/include/field_device_firmware.h`, `field-device/src/field_device_firmware.cpp`, `field-device/tests/field_device_simulator_test.cpp`, forbidden scheduler-OS markers blocked by verifier | Hardware port remains board-specific |
| nRF52840 devices | nRF52840 BACnet devices over wireless or wired transport, battery percentage | migrations `014`, `018`, `020`, seed data, API metadata, UI provisioning/device details | Physical nRF52840 radio/serial validation required |
| Device persistence | EEPROM/Flash persistent storage, retained setpoints, device-resident schedules | migrations `016`, `017`, `019`, UI configuration, `syncDeviceResidentSchedules`, field-device simulator storage tests | No software gap |
| OTA updates | Signed OTA, A/B boot partitions, rollback, schedule/setpoint retention | `POST /api/firmware/artifacts`, `POST /api/devices/:deviceId/ota-update`, firmware job tables, field-device OTA simulator | Superseded by concrete SWUpdate path below |
| SWUpdate OTA | Signed `.swu`, generated `sw-description`, `swupdate.install`, edge client, package updates | `node-api/server.js`, `edge-core/scripts/bems-swupdate-client.sh`, `edge-core/scripts/bems-system-package-update.sh`, `yocto/meta-bems/recipes-bems/edge-core/edge-core.bb` | Physical A/B bootloader validation required |
| Yocto image | `edge-core` machine, `core-image-sato` derived image, edge-core/node-api/SWUpdate packages | `yocto/meta-bems/conf/machine/edge-core.conf`, `yocto/meta-bems/recipes-bems/images/bems-edge-core-image.bb`, `yocto/README.md` | Requires BSP build and board flash |
| Production board validation | Physical flash, hardware inventory, serial adapter smoke, and update-cycle runbooks | `docs/production-board-flashing-and-update-cycle-testing.md`, `docs/physical-hardware-validation.md`, `scripts/production_board_flash_update_test.sh` | Execution requires lab hardware |
| Richer commissioning tools | Readiness scoring, per-device checklists, acceptance evidence, protocol smoke evidence, trend/alarm checks | `GET /api/commissioning/readiness`, `GET /api/commissioning/devices/:deviceId/checklist`, `POST /api/commissioning/devices/:deviceId/acceptance` | No software gap |
| Broader protocol coverage | BACnet, Modbus, CAN, KNX/IP, DALI-2, LonWorks, OPC UA, SNMP, REST, MQTT adapter contracts | `GET /api/protocols/catalog`, `POST /api/protocols/smoke-test`, `GET /api/edge/capabilities` | Physical/vendor gateway validation required |
| Long-run field hardening | Soak profiles, watchdog/metrics evidence, telemetry freshness, queue backlog, rollback drills | `GET /api/field-hardening/profile`, `POST /api/field-hardening/soak-test`, production harness `hardening-soak` action | Lab soak execution required |
| Field deployments and commercial readiness | Field deployment stages, vendor gateway testing, cybersecurity review, operator workflow, engineering workflow | `docs/commercial-readiness-field-deployment.md`, `GET /api/commercial-readiness/catalog`, `POST /api/commercial-readiness/review`, production harness `commercial-readiness` action | Site execution and sign-off required |
| Reporting | Summary, heat map, scheduled reports, due-run/manual-run, exports, filters, role permissions | reporting endpoints in `node-api/server.js`, report migrations, `ui/src/App.jsx`, `reports:view`, `reports:export`, `reports:manage` | No software gap |
| Admin users/RBAC | Admin user management, roles, sessions, audit | `node-api/auth.js`, auth/user routes, RBAC migrations, `ui/src/App.jsx` admin page | No software gap |
| AI optimization | Python AI service with gRPC contract and HTTP fallback | `ai-service/app.py`, `proto/ai_service.proto`, `node-api/aiClient.js`, `ai-service/test_app.py` | No software gap |
| Observability | Prometheus, Grafana, Alertmanager, health endpoints | `docker/monitoring/*`, `GET /api/health`, `GET /api/metrics` | No software gap |

## Diff Summary From The Original Architecture Baseline

The implementation has been tightened beyond the original architecture baseline in these ways:

- Edge orchestration is RabbitMQ AMQP only for Node-to-edge commands; stale direct-RPC edge artifacts are removed and blocked by verification.
- OTA is no longer generic. It is SWUpdate-based with signed `.swu` metadata, generated `sw-description`, an edge client wrapper, and explicit system package update support.
- The Yocto image now includes SWUpdate and the production board validation runbook/harness.
- BACnet server behavior includes a concrete object database and tests instead of only client-side simulator surfaces.
- The serial adapter is represented by implemented BACnet MS/TP frame endpoints and C++ fieldbus gateway tests.
- Reporting has expanded to scheduled reports, exports, filters, role-based access, and heat map support.
- Commissioning has expanded to readiness scoring, per-device acceptance evidence, protocol smoke evidence, and audit records.
- Protocol coverage has expanded with adapter contracts for KNX/IP, DALI-2, LonWorks, OPC UA, SNMP, REST, and MQTT.
- Field hardening has expanded with long-run soak profiles and production harness actions.
- Commercial readiness has expanded with field deployment, vendor gateway testing, cybersecurity review, operator workflow, and engineering workflow evidence plans.

## Verification Commands

Run these before design sign-off:

```bash
bash scripts/verify_architecture.sh
node --check node-api/server.js
node --check node-api/edgeClient.js
cd node-api && npm test
cd ../edge-core && cmake --build build && ctest --test-dir build --output-on-failure
scripts/production_board_flash_update_test.sh preflight
```

## Design Completion Decision

The repository design is complete when `scripts/verify_architecture.sh` passes. Physical deployment readiness is complete only after the production board runbook records a successful flash, signed SWUpdate install, rollback, package update, RabbitMQ OTA command, BACnet smoke test, and nRF52840 smoke test on target hardware.
