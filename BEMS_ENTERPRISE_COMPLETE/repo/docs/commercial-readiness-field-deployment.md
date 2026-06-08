# Commercial Readiness: Field Deployment, Gateway Testing, Cybersecurity, and Workflows

This runbook closes the remaining EcoStruxure-style commercial readiness items: field deployments, vendor gateway testing, cybersecurity review, and polished operator/engineering workflows.

## Field Deployment

Deployment stages:

- Site survey and equipment inventory.
- Network readiness, VLAN/firewall/NTP/DNS checks, and RabbitMQ/API reachability.
- Edge board installation and physical hardware validation.
- BACnet/IP, BACnet MS/TP, Modbus, CAN, and selected vendor gateway checkout.
- Commissioning readiness and per-device acceptance.
- Operator handover and engineering workflow training.
- Long-run field hardening soak and warranty burn-in.

Evidence sources:

- `docs/physical-hardware-validation.md`
- `docs/production-board-flashing-and-update-cycle-testing.md`
- `GET /api/commissioning/readiness`
- `POST /api/field-hardening/soak-test`

## Vendor Gateway Testing

Gateway classes:

- BACnet router or BBMD path.
- EIA-485 USB/RS-485 serial adapter.
- Modbus TCP gateway.
- KNX/IP gateway.
- DALI-2 lighting gateway.
- LonWorks interface.
- OPC UA server.
- SNMP manager or trap receiver.

Acceptance checks:

- Connectivity and credential validation.
- Read path and normalized point mapping.
- Write path where the protocol and safety policy allow writes.
- Alarm/event path.
- Timestamp and quality/status propagation.
- Recovery after gateway restart or link loss.

Use `GET /api/protocols/catalog`, `POST /api/protocols/smoke-test`, and `scripts/production_board_flash_update_test.sh protocol-smoke`.

## Cybersecurity Review

Review controls:

- Session authentication and role-based access control.
- Management-token protected remote actions.
- Audit event capture for security-sensitive actions.
- TLS termination and certificate management at deployment boundary.
- BACnet/fieldbus network segmentation.
- RabbitMQ, Kafka, MQTT, MySQL, and API credential rotation.
- Backup and restore drill.
- Least-privilege operator/admin/service account review.

Evidence sources:

- `GET /api/v1/audit-events`
- `GET /api/watchdog`
- `GET /api/metrics`
- `GET /api/events/status`
- `scripts/backup_mysql.sh`
- `scripts/restore_mysql.sh`

## Operator Workflow

Operator acceptance covers:

- Alarm triage, acknowledge, clear, and alarm log review.
- Trend chart review and report export.
- Schedule override and holiday/special event workflow.
- Setpoint approval and writeback safety.
- Maintenance mode activation and release.
- Commissioning readiness review.

## Engineering Workflow

Engineering acceptance covers:

- Device discovery and provisioning.
- BACnet object map and equipment map review.
- Protocol smoke-test mapping.
- Device configuration, retained setpoint, and persistent schedule setup.
- Floorplan/graphics binding.
- Commissioning checklist and acceptance evidence.

## API Surfaces

- `GET /api/commercial-readiness/catalog`
- `POST /api/commercial-readiness/review`
- `GET /api/protocols/catalog`
- `POST /api/protocols/smoke-test`
- `GET /api/commissioning/readiness`
- `POST /api/field-hardening/soak-test`

## Sign-Off

Commercial readiness requires:

- Field deployment evidence complete.
- Vendor gateway testing complete for every site gateway.
- Cybersecurity review complete.
- Operator workflow handover complete.
- Engineering workflow handover complete.
- Long-run field hardening soak accepted.
