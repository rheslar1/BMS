# Commissioning, Protocol Coverage, and Field Hardening

This document closes the commercial-readiness gaps identified during the EcoStruxure-style comparison: richer commissioning tools, broader protocol coverage, and long-run field hardening.

## Richer Commissioning Tools

Implemented API surfaces:

- `GET /api/commissioning/readiness`
- `GET /api/commissioning/devices/:deviceId/checklist`
- `POST /api/commissioning/devices/:deviceId/acceptance`

Commissioning readiness verifies:

- Device identity and BACnet/object mapping.
- Present-value availability.
- Protocol smoke-test evidence.
- Trend or telemetry sample evidence.
- Alarm-path evidence.
- Device-resident schedule or retained setpoint evidence.
- Operator acceptance evidence.

Acceptance evidence is stored in device `configuration.commissioningEvidence` and is also written to audit events.

## Broader Protocol Coverage

Implemented API surfaces:

- `GET /api/protocols/catalog`
- `POST /api/protocols/smoke-test`
- Existing protocol-specific endpoints for BACnet/IP, BACnet MS/TP, Modbus RTU, CAN bus, REST, MQTT, and Energy Services Interface payloads.

Protocol catalog coverage:

- BACnet/IP
- BACnet/IPv6
- BACnet MS/TP over EIA-485
- Modbus RTU over EIA-485
- Modbus TCP
- CAN bus
- KNX/IP
- DALI-2
- LonWorks
- OPC UA
- SNMP
- REST API
- MQTT over TLS

The smoke-test API returns protocol-specific command metadata and the normalized BEMS point mapping. Protocols without an in-process driver are represented as adapter-ready command contracts so site gateways can bind real vendor libraries or gateways without changing the BEMS object model.

## Long-Run Field Hardening

Implemented API surfaces:

- `GET /api/field-hardening/profile`
- `POST /api/field-hardening/soak-test`

Hardening profiles:

- `commissioning-24h`
- `site-acceptance-7d`
- `warranty-burn-in-30d`

Acceptance thresholds include:

- Watchdog dependency availability.
- Telemetry freshness.
- RabbitMQ command backlog.
- BACnet read success rate.
- COV event gap limits.
- OTA rollback drill evidence.
- Persistent schedule retention evidence.

The production lab harness `scripts/production_board_flash_update_test.sh` includes `commissioning-readiness`, `protocol-smoke`, and `hardening-soak` actions so field teams can exercise these checks during acceptance testing.
