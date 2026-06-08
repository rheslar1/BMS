# IntelliBuild Energy Backend Design

This document describes the current backend design for IntelliBuild Energy and the rules for extending it into a commercial BMS/BEMS platform. It should match the implementation in `node-api/`, `database/`, `ai-service/`, `edge-core/`, `proto/`, and `docker/`.

## Design Goals

- Serve the React operator UI through a stable HTTP/JSON API.
- Keep BACnet, fieldbus, writeback, and controller-facing logic in the C++ edge core.
- Use RabbitMQ AMQP for Node-to-edge command delivery.
- Use gRPC for the Python AI optimization service when `AI_GRPC_ENDPOINT` is configured.
- Use Server-Sent Events for browser live updates. WebSockets are intentionally not used.
- Persist enterprise state, building hierarchy, BACnet object metadata, users, roles, alarms, schedules, trend logs, analytics, AI history, reports, OTA jobs, and maintenance workflows in MySQL.
- Scale from one local building to multi-site enterprise operation through organization, site, building, role, and audit context.
- Keep local control resilient when optional Kafka, RabbitMQ, MQTT, or AI dependencies are unavailable.

## System Boundary

```text
Operator Browser
  -> React UI
     -> HTTP/JSON commands to Node.js API
     -> SSE telemetry and alarm streams from Node.js API

Node.js Web API
  -> MySQL persistence
  -> RabbitMQ AMQP edge command queue
  -> Python AI service over gRPC
  -> Kafka backend event stream when configured
  -> MQTT/TLS cloud event bridge when configured
  -> Prometheus metrics, watchdog, remote management, auth, RBAC, audit

Python AI Service
  -> Whole-building optimization
  -> Reinforcement-learning feedback
  -> Predictive simulation and weather/pricing context
  -> HTTP health/fallback API plus gRPC optimization contract

C++ Edge Core
  -> RabbitMQ command consumer boundary
  -> BACnet/IP discovery, ReadProperty, ReadPropertyMultiple, WriteProperty, SubscribeCOV
  -> ConfirmedCOVNotification and UnconfirmedCOVNotification parsing
  -> Safe writeback, simulator mode, fieldbus adapters, energy forecast, OTA command handling

MySQL
  -> Enterprise SaaS, building model, alarms, schedules, trends, reports, AI history, FDD, maintenance, OTA
```

## Runtime Flow

```text
Read/monitor path:
  BACnet device/object
    -> C++ edge core
    -> telemetry/provisioning/COV event path
    -> Node.js API
    -> SSE browser projection
    -> MySQL trend logs and analytics

Command path:
  React UI or external API
    -> Node.js validation, RBAC, audit, safety checks
    -> RabbitMQ `bems.edge.commands`
    -> edge worker or nRF52840 field-device bridge
    -> BACnet WriteProperty, SubscribeCOV, OTA install, or local field-device command

AI path:
  Node.js builds whole-building state
    -> Python AI service over `bems.ai.v1.AiOptimizationService`
    -> recommended actions, reward, comfort/energy/cost impact, notes
    -> Node.js persistence, audit, optional approved writeback
```

Synchronous HTTP edge endpoints return queued status or local fallback projections where appropriate. Authoritative point values arrive through telemetry, provisioning, trend, and COV events rather than direct edge RPC responses.

## Event And Command Topology

The backend is event-driven.

- Browser live data: SSE only.
- Backend service events: Kafka when configured.
- Edge commands and durable work fanout: RabbitMQ AMQP.
- Cloud telemetry and alerts: optional MQTT over TLS.
- Local API behavior: continues with fallback status/error payloads when optional transports are unavailable.

Core event families:

- `bems.telemetry`
- `bems.telemetry.live`
- `bems.alarms`
- `bems.alarms.snapshot`
- `bems.analytics`
- `bems.ai.control`
- `bems.ai.simulation`
- `bems.ai.demand_response`
- `bems.building.footprint`
- `bems.edge.commands`

## Core Data Model

Use the implemented hierarchy for operator navigation and enterprise scoping:

```text
Organization
  -> Site
     -> Building
        -> Floor
           -> Room
              -> Zone
                 -> Device / normalized BACnet point record
                    -> BACnet object identity: object type, object instance, present-value
```

Important modeling rules:

- BACnet remains flat: `Device -> Objects`.
- The database adds enterprise and operator context around BACnet identity.
- The stored zone is the control boundary for BACnet, AI, schedules, alarms, and maintenance modes.
- Rooms and floors provide display/navigation context through `zonePath = floorName / roomName`.
- The current `devices` table stores normalized device/point records including `bacnet_instance`, `object_type`, `object_instance`, `present_value`, units, status, commissioning flags, and JSON configuration.
- Device-resident schedule and persistent-storage metadata live in device configuration JSON and related migrations.

Core tables:

- Enterprise: `organizations`, `sites`, `feature_flags`
- Building model: `buildings`, `floors`, `rooms`, `zones`, `devices`
- Auth/RBAC: `users`, `roles`, `user_sessions`, `audit_events`
- Scheduling: `schedules`, `holiday_schedules`, `special_events`
- Alarms/notifications: `alarms`, `alarm_logs`, `notification_outbox`
- Telemetry/reporting: `trend_logs`, `report_schedules`, `report_exports`, `report_schedule_runs`
- AI/FDD/analytics: `analytics_events`, `building_optimization_runs`, `optimization_history`, `rl_q_values`, `fdd_findings`
- Maintenance: `maintenance_tickets`, `maintenance_modes`
- Firmware/OTA: `firmware_artifacts`, `firmware_update_jobs`

## API Design

The browser API is HTTP/JSON plus SSE. Versioned `/api/v1/*` endpoints are used for enterprise integration, auth context, status, organizations, sites, admin summary, feature flags, and audit events.

Primary endpoint families:

- Enterprise: `/api/v1/status`, `/api/v1/openapi.json`, `/api/v1/auth/login`, `/api/v1/auth/logout`, `/api/v1/auth/context`, `/api/v1/organizations`, `/api/v1/sites`, `/api/v1/admin/summary`, `/api/v1/audit-events`
- Building model: `/api/buildings`, `/api/buildings/:buildingId/floors`, `/api/floors/:floorId/rooms`, `/api/rooms/:roomId/zones`, `/api/zones/:zoneId/devices`, `/api/hierarchy`, `/api/digital-twin`
- Device and BACnet: `/api/devices`, `/api/devices/:deviceId`, `/api/devices/provision`, `/api/bacnet/discovery`, `/api/bacnet/object-map`, `/api/bacnet/equipment-map`, `/api/bacnet/vendor-metadata`
- Edge commands: `/api/edge/health`, `/api/edge/capabilities`, `/api/edge/command-transport`, `/api/edge/read-point`, `/api/edge/read-points-batch`, `/api/edge/write-point`, `/api/edge/subscribe-cov`, `/api/edge/cov-notifications`, `/api/edge/commands`
- Field protocols: `/api/bacnet/mstp/read`, `/api/bacnet/mstp/write`, `/api/modbus/rtu/read`, `/api/modbus/rtu/write`, `/api/canbus/send`, `/api/protocols/catalog`, `/api/protocols/smoke-test`
- Real-time: `/api/telemetry/stream`, `/api/alarms/stream`
- Alarms: `/api/alarms`, `/api/alarm-logs`, `/api/alarms/:alarmId/ack`, `/api/alarms/:alarmId/clear`
- Scheduling: `/api/schedules`, `/api/schedules/effective`, `/api/holiday-schedules`, `/api/special-events`
- Trends/reports: `/api/trends`, `/api/trends/snapshot`, `/api/history`, `/api/reports/summary`, `/api/reports/heat-map`, `/api/reports/export`, `/api/reports/exports`, `/api/reports/trends.csv`, `/api/reports/energy.pdf`, `/api/reports/schedules`, `/api/reports/schedule-runs`
- AI/autonomous mode: `/api/ai/optimization`, `/api/ai/building-optimization`, `/api/ai/reinforcement/policy`, `/api/ai/optimization-history`, `/api/ai/weather-pricing`, `/api/ai/smart-grid`, `/api/ai/demand-response`, `/api/ai/predictive-simulation`, `/api/ai/decision-loop`, `/api/ai/control/status`, `/api/ai/control/iterate`, `/api/autonomous-mode/profiles`, `/api/autonomous-mode/evaluate`
- FDD/maintenance: `/api/fdd/findings`, `/api/fdd/analyze`, `/api/maintenance/tickets`, `/api/maintenance/modes`
- Energy services: `/api/energy/forecast`, `/api/buildings/footprint`, `/api/energy-services/esi`, `/api/energy-services/signals`, `/api/energy-services/bws`
- OTA/firmware: `/api/firmware/artifacts`, `/api/firmware/artifacts/:artifactId/sw-description`, `/api/firmware/ota-jobs`, `/api/devices/:deviceId/ota-update`
- Operations: `/api/health`, `/api/watchdog`, `/api/events/status`, `/metrics`, `/api/remote/status`, `/api/remote/restart`, `/api/remote/update`, `/api/remote/watchdog/run`

Keep the complete endpoint catalog in `docs/api-surface.md` synchronized with `node-api/server.js`.

## Edge Command Contract

Node.js does not directly encode BACnet packets and does not call the edge core through a direct RPC service. Edge work is queued through RabbitMQ.

Current command topic:

```text
Exchange:  bems.events
Topic:     bems.edge.commands
Routing:   edge.commands
Transport: RabbitMQ AMQP
```

Current command types:

- `bacnet.discover_devices`
- `bacnet.read_property`
- `bacnet.read_property_multiple`
- `bacnet.write_property`
- `bacnet.subscribe_cov`
- `edge.energy_forecast`
- `swupdate.install`
- `nrf52840.ota_update`
- `field_device.command`

Edge command response rules:

- Read/discovery requests may return queued status immediately.
- Point values are delivered later through telemetry, provisioning, COV notification, or trend paths.
- Write requests return accepted/queued status and should be audited.
- COV subscription requests return accepted/queued status; notifications are ingested through `/api/edge/cov-notifications`.
- If RabbitMQ is unavailable, responses must make the failure visible without breaking unrelated local UI/API workflows.

## Edge Core Responsibilities

The C++ edge core owns field communication and low-level control:

- BACnet/IP socket setup and UDP port `47808`.
- BVLC, NPDU, and APDU handling.
- Who-Is/I-Am discovery.
- ReadProperty for `present-value`.
- ReadPropertyMultiple for same-device batch reads with single-read fallback.
- WriteProperty for approved command values.
- SubscribeCOV setup.
- ConfirmedCOVNotification and UnconfirmedCOVNotification parsing.
- Safe writeback with clamp, verification read, and rollback where possible.
- Simulator mode for CI and demos.
- BACnet server/device object database.
- Fieldbus gateway contracts for BACnet MS/TP/EIA-485, Modbus RTU, CAN, and adapter smoke tests.
- Energy forecast and local control strategy support.
- SWUpdate install command execution on target hardware.

## BACnet Design

BACnet support targets an ANSI/ASHRAE 135-2020 aligned integration subset.

Supported project services:

- Who-Is
- I-Am
- ReadProperty
- ReadPropertyMultiple
- WriteProperty
- SubscribeCOV
- ConfirmedCOVNotification
- UnconfirmedCOVNotification

Supported object types:

- Device
- Analog Input
- Analog Output
- Analog Value
- Binary Input
- Binary Output
- Binary Value
- Schedule

Commercial wording should remain "BACnet/IP integration ready" or "BACnet 135-2020 aligned" until a completed PICS, protocol test evidence, and required BTL/customer certification are available.

## Scheduling Design

Schedules are layered by scope and exception type:

```text
global
  < building
    < zone
      < device
        < holiday
          < special event
```

Implementation rules:

- `schedules` supports daily, monthly, and yearly recurrence.
- `scope_type` and `override_priority` determine schedule precedence.
- Building, zone, and device scopes are supported.
- `holiday_schedules` adds global or building date exceptions.
- `special_events` adds time-bounded global, building, zone, or device exceptions.
- `GET /api/schedules/effective` resolves the active schedule set for a target building, zone, device, and date.
- Device-resident BACnet Schedule object metadata is stored in device configuration and mirrored where supported.

## Alarm Design

Alarms are event-oriented.

- `alarms` stores current alarm state.
- `alarm_logs` stores append-only lifecycle events.
- Acknowledge and clear actions are preserved.
- Alarm snapshots are sent to browser clients by SSE.
- Alarm events publish to the backend event bus.
- Email/notification delivery uses `notification_outbox`.
- Administrative and security actions use `audit_events`.

## Trend And Reporting Design

Trend logs persist selected device values from the live digital twin and COV/event paths.

Trend records include:

- Building, zone, and device references.
- BACnet object type and object instance.
- Metric name and value.
- Units.
- Source.
- Timestamp.

Reporting supports:

- Recent trends for graphics, diagnostics, and analytics.
- Manual snapshots from current digital-twin values.
- Summary KPIs for trends, alarms, FDD, optimization, cost, and carbon.
- Heat-map views.
- CSV, JSON, and PDF exports.
- Scheduled reports, due-run/manual-run execution, export run history, and notification outbox delivery records.
- Permissions: `reports:view`, `reports:export`, and `reports:manage`.

## Real-Time Monitoring

Browser monitoring uses Server-Sent Events.

- `/api/telemetry/stream` periodically emits the current digital twin.
- `/api/alarms/stream` emits alarm snapshots.
- Backend event publication can feed Kafka, RabbitMQ, MQTT, history, reports, analytics, or cloud subscribers.
- WebSockets are not part of the product architecture.

The UI should show:

- Telemetry stream status.
- Alarm stream status.
- Latest BACnet/device point values.
- Online/offline device counts.
- Active alarm count.
- Trend logging readiness.
- Edge command transport health.

## AI And Analytics Design

The AI service receives whole-building state through the Node API.

Inputs:

- Zone temperatures.
- Device present values.
- Setpoints, ranges, and writable point metadata.
- Occupancy mode.
- Weather and energy price context.
- Demand-response state.
- Grid price signal, current demand, demand limit, storage availability, and renewable availability.
- Maintenance lockouts.
- Existing PPO reinforcement policy/value state.
- Comfort and safety constraints.

Outputs:

- Recommended control actions.
- Predicted energy impact.
- Comfort impact.
- Reward score.
- Explainability notes.
- Demand-response and Smart Grid AI actions for HVAC, lighting, power, and storage.

Persistence:

- `building_optimization_runs`
- `optimization_history`
- `rl_q_values`
- `analytics_events`
- `fdd_findings`

The current gRPC contract is `bems.ai.v1.AiOptimizationService` with `Health`, `Optimize`, and `Feedback`. Payloads are JSON strings inside protobuf messages, so typed service evolution should happen through a future proto expansion if stronger compile-time schema guarantees are required.

AI control model:

- The HVAC control problem is modeled as an MDP.
- Each hourly control interval builds a state from environmental readings, occupancy, weather, pricing, demand-response state, device values, comfort deviation, and maintenance lockouts.
- Actions are airflow, load, or temperature/setpoint adjustments.
- Rewards combine comfort, energy, cost, peak-demand, and carbon-emissions impact.
- The target DRL policy uses PPO because clipped policy updates are safer for iterative building control than large unstable policy jumps.
- Production PPO can be backed by deep neural networks that learn control policies from building state and simulation history instead of guessing fixed setpoints.
- The current repository preserves this PPO contract with compact policy/value state in `rl_q_values`; a trained neural PPO agent can replace the surrogate behind the same service boundary.
- The generalization goal is meta-RL style adaptation across building layouts: reuse a learned policy and fine-tune quickly for a new property instead of starting from scratch.

## Smart Grid AI Design

Smart Grid AI coordinates mixed energy and building systems without violating life-safety, security, comfort, or maintenance boundaries.

Inputs:

- Grid signal: normal, elevated, demand response, or emergency.
- Current demand and demand limit.
- Electricity price and demand charge.
- Renewable and storage availability.
- Occupancy from security/access systems.
- Fire/life-safety state.
- HVAC zone comfort and equipment state.
- Lighting and power meter state.

Outputs:

- Demand risk.
- Reserve margin.
- Target kW reduction.
- HVAC setpoint/load recommendations.
- Noncritical lighting recommendations.
- Power/load-shed recommendations.
- Storage dispatch recommendation.
- Fire/security/HVAC integration policy.

Guardrails:

- Fire/life-safety always has priority.
- Security and occupancy inform scheduling and ventilation.
- HVAC remains comfort-bounded and maintenance-aware.
- Active maintenance mode blocks automatic AI/control writeback for covered buildings, zones, or devices.
- Operator-visible APIs distinguish simulation/recommendation from applied control.

## FDD And Maintenance Design

Fault detection and maintenance workflows connect AI findings, alarms, tickets, and lockouts.

- `fdd_findings` stores detected faults and supporting evidence.
- `maintenance_tickets` stores service workflow state.
- `maintenance_modes` blocks writeback for a building, zone, or device while work is active.
- FDD can create alarms or maintenance tickets.
- AI control must skip devices covered by active maintenance mode.

## Security And Administration

The backend supports session authentication and RBAC.

- `users` stores account state and password hashes.
- `roles` stores permission sets.
- `user_sessions` stores session tokens.
- `audit_events` records administrative/security actions.
- Auth can be required with `BEMS_REQUIRE_AUTH=true`.
- Remote management endpoints can be protected with `BEMS_MANAGEMENT_TOKEN` and `X-Management-Token`.
- Permissions should be checked on mutating or privileged routes such as device management, schedules, reports, alarms, roles, and users.

## Firmware And OTA Design

BACnet bare-metal and edge field devices support signed SWUpdate-based OTA orchestration.

- `POST /api/firmware/artifacts` creates artifact metadata and generated `sw-description`.
- `GET /api/firmware/artifacts/:artifactId/sw-description` serves the descriptor for package assembly/audit.
- `POST /api/devices/:deviceId/ota-update` records an OTA job and queues `swupdate.install` through RabbitMQ.
- Artifact metadata includes version, channel, URI, checksum, signature, signing key ID, software set/mode, A/B boot metadata, rollback policy, persistent setpoint retention, device-resident schedule retention, and optional system package update metadata.
- RSA-SHA256 is used when `OTA_PRIVATE_KEY_PEM` is configured; otherwise the development HMAC signer is used.
- Production rollback proof requires target bootloader and storage validation.

## Commissioning And Field Hardening

Commissioning endpoints provide readiness and acceptance evidence:

- `/api/commissioning/readiness`
- `/api/commissioning/devices/:deviceId/checklist`
- `/api/commissioning/devices/:deviceId/acceptance`
- `/api/field-hardening/profile`
- `/api/field-hardening/soak-test`
- `/api/commercial-readiness/catalog`
- `/api/commercial-readiness/review`

Use these workflows to collect:

- Device discovery and provisioning evidence.
- Protocol smoke-test results.
- Trend and alarm readiness.
- Commissioning acceptance notes.
- Long-run soak-test status.
- Cybersecurity, operator, and engineering handover evidence.
- Physical hardware validation sign-off where required.

## Scalability Model

Small building:

- One edge core.
- One Node API.
- One MySQL database.
- One React UI.
- Optional local AI service.
- Simulator or direct BACnet/IP network.

Campus:

- Edge appliance per building, plant, or network segment.
- Shared enterprise Node API and MySQL tenant/site/building model.
- Centralized alarms, reports, users, roles, schedules, analytics, and audit.
- Distributed field protocols normalized into the same building model.

Enterprise:

- Multiple organizations/sites/buildings.
- Session auth and RBAC.
- Remote management and watchdog checks.
- Distributed edge gateways.
- Central analytics, reporting, FDD, and demand response.
- Optional Kafka/MQTT integration for downstream systems and cloud IoT.

## Observability And Operations

Operational endpoints:

- `/api/health`
- `/api/watchdog`
- `/api/events/status`
- `/metrics`
- `/api/remote/status`
- `/api/remote/restart`
- `/api/remote/update`
- `/api/remote/watchdog/run`

Operational stack:

- Prometheus metrics and alert rules.
- Grafana dashboard provisioning.
- Alertmanager email/Slack placeholders.
- Optional ELK logging profile.
- Backup/restore scripts for MySQL.
- Canary, promotion, and rollback scripts.
- GitHub Actions CI/CD workflows.

## Deployment Model

Local/demo deployment:

```bash
cd repo/docker
docker compose up --build -d
```

Target services:

- `node-api`: Express API, REST, SSE, RBAC, orchestration, metrics.
- `ui`: React app served to operators.
- `db`: MySQL durable state.
- `ai-service`: Python HTTP/gRPC optimizer.
- `edge-core`: C++ BACnet runtime and edge command boundary.
- `rabbitmq`: edge command queue.
- `kafka`: backend event stream when enabled.
- `prometheus`, `grafana`, `alertmanager`: observability.

Embedded/field deployment:

- Digi ConnectCore i.MX93-class appliance or equivalent edge gateway.
- Yocto layer in `yocto/meta-bems`.
- Systemd service for edge core.
- SWUpdate for signed `.swu` installs and update-cycle testing.
- BACnet/IP on UDP `47808`.
- Optional BACnet MS/TP/EIA-485, Modbus RTU, CAN, and nRF52840 field-device validation.

## Extension Rules

When adding backend features:

- Keep browser commands HTTP/JSON and browser live updates SSE-only.
- Put BACnet packet encoding and field protocol work in the edge core or fieldbus adapters.
- Queue edge/nRF52840 commands through RabbitMQ.
- Use MySQL for durable operator, enterprise, report, audit, schedule, alarm, and analytics state.
- Use gRPC only where a service contract is explicitly defined, currently the AI service.
- Preserve organization/site/building/zone/device context in queries and writes.
- Enforce RBAC and audit on privileged changes.
- Respect active maintenance modes before any automatic writeback.
- Publish meaningful domain events for telemetry, alarms, analytics, AI control, OTA, and footprint workflows.
- Update `docs/api-surface.md`, `docs/database-schema.md`, and `docs/architecture-implementation-diff.md` when contracts change.

## Verification

Run these before backend design sign-off:

```bash
bash scripts/verify_architecture.sh
node --check node-api/server.js
node --check node-api/edgeClient.js
cd node-api && npm test
cd ../edge-core && cmake --build build && ctest --test-dir build --output-on-failure
scripts/production_board_flash_update_test.sh preflight
```

Physical deployment readiness is complete only after target hardware validation records successful board flashing, signed SWUpdate install, rollback, package update, RabbitMQ OTA command delivery, BACnet smoke testing, and required field-device checks.
