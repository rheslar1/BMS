# BEMS API Surface

This file mirrors the API layer described in `architecture.md`.

## Enterprise API

- `GET /api/v1/status`
- `GET /api/v1/openapi.json`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/organizations`
- `GET /api/v1/sites`
- `GET /api/v1/admin/summary`
- `GET /api/v1/audit-events`

## Building Model

- `GET /api/buildings`
- `GET /api/buildings/:buildingId/floors`
- `GET /api/buildings/:buildingId/zones`
- `GET /api/floors/:floorId/rooms`
- `GET /api/rooms/:roomId/zones`
- `GET /api/zones/:zoneId/devices`
- `GET /api/hierarchy`
- `GET /api/digital-twin`

Zone display labels use `zonePath = floorName / roomName`; the stored zone remains the control boundary for BACnet, AI, schedules, and alarms.

## Device and BACnet

- `GET /api/devices`
- `GET /api/devices/:deviceId`
- `POST /api/devices/provision`
- `PATCH /api/devices/:deviceId/configuration`
- `PATCH /api/devices/:deviceId/setpoint`
- `PATCH /api/devices/:deviceId/range`
- `PATCH /api/devices/:deviceId/provision`
- `PATCH /api/devices/:deviceId/commission`
- `GET /api/commissioning/readiness`
- `GET /api/commissioning/devices/:deviceId/checklist`
- `POST /api/commissioning/devices/:deviceId/acceptance`
- `GET /api/edge/health`
- `GET /api/energy/forecast`
- `GET /api/energy-services/esi`
- `GET /api/energy-services/signals`
- `GET /api/energy-services/bws`
- `POST /api/edge/read-point`
- `POST /api/edge/read-points-batch`
- `POST /api/edge/write-point`
- `POST /api/edge/commands`
- `GET /api/edge/command-transport`
- `POST /api/edge/subscribe-cov`
- `POST /api/edge/cov-notifications`
- `GET /api/bacnet/device-discovery`
- `GET /api/bacnet/discovery`
- `GET /api/bacnet/object-map`
- `GET /api/bacnet/equipment-map`
- `GET /api/bacnet/vendor-metadata`
- `POST /api/bacnet/mstp/read`
- `POST /api/bacnet/mstp/write`
- `POST /api/provisioning/discover`
- `GET /api/provisioning/status`
- `POST /api/modbus/rtu/read`
- `POST /api/modbus/rtu/write`
- `POST /api/canbus/send`
- `GET /api/protocols/catalog`
- `POST /api/protocols/smoke-test`
- `GET /api/field-hardening/profile`
- `POST /api/field-hardening/soak-test`
- `GET /api/commercial-readiness/catalog`
- `POST /api/commercial-readiness/review`

The edge API queues read, write, COV, OTA, and nRF52840 field-device commands through RabbitMQ AMQP when `EDGE_COMMAND_TRANSPORT=rabbitmq`. BACnet/IP operations include Who-Is/I-Am discovery, ReadProperty, ReadPropertyMultiple batch reads with single ReadProperty fallback, WriteProperty, SubscribeCOV, and ConfirmedCOVNotification/UnconfirmedCOVNotification ingestion. BACnet MS/TP endpoints generate ReadProperty and WriteProperty present-value frames for the implemented EIA-485 serial adapter path in the C++ fieldbus gateway. BACnet enrichment endpoints expose object-list point mapping, AHU/VAV/zone equipment relationships, and vendor/model/firmware metadata from discovered and provisioned devices. The runtime is COV-first; fallback polling is limited to critical points and explicit batch reads.
Modbus RTU endpoints generate RS-485 request frames for holding-register reads and single-register writes. CAN bus endpoints validate classic CAN frames for SocketCAN-ready integration.

The Energy Services Interface endpoints expose BACnet Web Services style structured energy data. They let an external energy data client consume complex building signals without depending on the underlying field network. The source can be BACnet/IP, BACnet MS/TP, Modbus RTU/TCP, CAN, KNX/IP, DALI-2, LonWorks, OPC UA, SNMP, simulator data, trend logs, analytics, REST, or MQTT over TLS. Commissioning, field-hardening, and commercial-readiness endpoints add readiness scoring, device acceptance evidence, protocol smoke tests, vendor gateway testing, cybersecurity review, operator/engineering workflow review, and long-run soak-test profiles.

## Real-Time SSE

- `GET /api/telemetry/stream`
- `GET /api/alarms/stream`
- `GET /api/trends`
- `POST /api/trends/snapshot`
- `GET /api/history`
- `GET /api/reports/summary`
- `GET /api/reports/heat-map`
- `GET /api/reports/export`
- `GET /api/reports/exports`
- `GET /api/reports/schedules`
- `POST /api/reports/schedules`
- `PATCH /api/reports/schedules/:scheduleId`
- `GET /api/reports/schedule-runs`
- `POST /api/reports/schedules/run-due`
- `POST /api/reports/schedules/:scheduleId/run`
- `GET /api/reports/trends.csv`
- `GET /api/reports/energy.pdf`

The project does not use WebSockets.

Trend logs persist sampled BACnet/device present values for reports, graphics trends, diagnostics, and analytics. Reporting endpoints summarize trend samples, active alarms, FDD findings, optimization history, heat-map intensity, and export links. CSV/JSON/PDF exports support days/building/zone/device/metric filters. Scheduled reports include next-run calculation, manual run, due-run execution, export run history, and notification outbox delivery records. Reporting is protected by `reports:view`, `reports:export`, and `reports:manage` permissions.

## AI and Autonomous Mode

- `GET /api/autonomous-mode/profiles`
- `GET /api/autonomous-mode/evaluate`
- `POST /api/autonomous-mode/evaluate`
- `GET /api/ai/optimization`
- `GET /api/ai/building-optimization`
- `GET /api/ai/reinforcement/policy`
- `GET /api/ai/optimization-history`
- `POST /api/ai/reinforcement/feedback`
- `GET /api/ai/weather-pricing`
- `GET /api/ai/smart-grid`
- `GET /api/ai/demand-response`
- `GET /api/ai/temperature-trends`
- `GET /api/ai/airflow-graph`
- `POST /api/ai/predictive-simulation`
- `POST /api/ai/optimize-operation`
- `POST /api/ai/decision-loop`
- `GET /api/ai/control/status`
- `POST /api/ai/control/iterate`
- `POST /api/ai/control/start`
- `POST /api/ai/control/stop`

Smart Grid AI returns demand risk, grid price/signal state, recommended load reduction, mixed-system actions, and integration policy for fire, security, HVAC, lighting, and power monitoring.

Demand response exposes a utility-event adapter shape with OpenADR-ready metadata, load-reduction dispatch plans, and safety policies. Temperature trends use 30 days of history to predict zone thermal drift. Predictive simulation includes an EnergyPlus-ready physics adapter path.

## FDD and Maintenance

## BACnet Field Device OTA

- `POST /api/devices/:deviceId/ota-update`
- `GET /api/firmware/artifacts`
- `POST /api/firmware/artifacts`
- `GET /api/firmware/artifacts/:artifactId/sw-description`
- `GET /api/firmware/ota-jobs`

Creates signed SWUpdate `.swu` firmware artifact manifests and queues signed OTA firmware updates for BACnet bare-metal field devices. The workflow records version, channel, SWUpdate artifact URI, checksum, signature, signing key id, `sw-description`, software set/mode, optional `systemPackages` and `packageManager`, rollback policy, job state, and staged A/B bootloader metadata while preserving retained setpoints and device-resident BACnet schedules. Device install commands are queued as RabbitMQ `swupdate.install` messages, and the edge client invokes `swupdate -i` with the configured software set and mode before applying explicit system package updates through `opkg`, `dnf`, or `apt`.

- `GET /api/fdd/findings`
- `POST /api/fdd/analyze`
- `GET /api/maintenance/tickets`
- `POST /api/maintenance/tickets`
- `PATCH /api/maintenance/tickets/:ticketId/status`
- `GET /api/maintenance/modes`
- `POST /api/maintenance/modes`
- `PATCH /api/maintenance/modes/:modeId/disable`

Maintenance mode can be scoped to a building, zone, or device. AI writeback skips devices covered by active maintenance mode.

## Admin, Users, Roles

- `GET /api/roles`
- `POST /api/roles`
- `PATCH /api/roles/:roleId`
- `DELETE /api/roles/:roleId`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:userId/role`
- `PATCH /api/users/:userId/active`
- `PATCH /api/users/:userId/password`
- `DELETE /api/users/:userId`

## Alarms, Schedules, Analytics

- `GET /api/alarms`
- `GET /api/alarm-logs`
- `POST /api/alarms`
- `PATCH /api/alarms/:alarmId/ack`
- `PATCH /api/alarms/:alarmId/clear`
- `GET /api/schedules`
- `GET /api/schedules/effective`
- `POST /api/schedules`
- `PATCH /api/schedules/:scheduleId`
- `PATCH /api/schedules/:scheduleId/enable`
- `PATCH /api/schedules/:scheduleId/disable`
- `DELETE /api/schedules/:scheduleId`
- `GET /api/holiday-schedules`
- `POST /api/holiday-schedules`
- `PATCH /api/holiday-schedules/:holidayId/disable`
- `GET /api/special-events`
- `POST /api/special-events`
- `PATCH /api/special-events/:eventId/disable`
- `GET /api/analytics/summary`
- `POST /api/analytics/events`

Schedules support `daily`, `monthly`, and `yearly` recurrence. Override order is device > zone > building > global for matching action/window definitions.

Holiday schedules add date-based or yearly recurring building/global exceptions. Special events add priority-based temporary overrides at building, zone, or device scope. `GET /api/schedules/effective` includes active holidays and special events in the returned effective schedule set.

Alarm logs are append-only records for alarm create, acknowledge, and clear events.

## Watchdog and Remote Management

- `GET /api/health`
- `GET /api/watchdog`
- `GET /api/events/status`
- `GET /api/remote/status`
- `POST /api/remote/restart`
- `POST /api/remote/update`
- `POST /api/remote/watchdog/run`

Remote management can be protected with `BEMS_MANAGEMENT_TOKEN` and `X-Management-Token`.

`GET /api/events/status` reports Kafka event streaming state and topic names. Browser live updates remain SSE-only; Kafka is used for backend telemetry, alarms, analytics, AI control, and footprint event streams.
