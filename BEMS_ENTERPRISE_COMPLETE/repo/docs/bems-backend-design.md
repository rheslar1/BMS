# Designing Your Own BEMS Backend

This guide describes the backend design used by this project and how to extend it into a commercial BMS/BEMS platform.

## Backend Goals

- Serve a modern React web UI.
- Keep BACnet and field protocol logic at the edge.
- Store building hierarchy, devices, schedules, alarms, users, roles, analytics, and optimization history in MySQL.
- Use gRPC for low-latency typed service boundaries.
- Use Server-Sent Events for live browser updates; do not use WebSockets.
- Scale from one building to a campus by adding sites, buildings, and edge cores.

## Recommended Service Boundaries

```text
React UI
  -> Node.js Web API
      -> MySQL repositories
      -> AI service client over gRPC
      -> Edge core client over gRPC
      -> SSE telemetry and alarm streams

Python AI Service
  -> Optimization, simulation, RL feedback, weather/pricing context

C++ Edge Core
  -> BACnet/IP discovery, ReadProperty, WriteProperty, SubscribeCOV
  -> Safe writeback and simulator support

MySQL
  -> Enterprise SaaS, building model, alarms, schedules, analytics, AI history
```

## Core Data Model

Use a hierarchy that can represent both a small building and a large campus:

```text
Organization
  -> Site
     -> Building
        -> Floor
           -> Zone
              -> Room
                 -> Device
                    -> Points: AI, AO, AV, BI, BO, BV, schedule
```

BACnet mapping rule: BACnet remains flat (`Device -> Objects`). The database adds building, floor, zone, and room context around BACnet device/object metadata.

Recommended tables:

- `organizations`, `sites`
- `buildings`, `floors`, `rooms`, `zones`
- `devices`
- `schedules`, `holiday_schedules`, `special_events`
- `alarms`, `alarm_logs`
- `trend_logs`
- `users`, `roles`, `user_sessions`, `audit_events`
- `analytics_events`, `optimization_history`, `rl_q_values`
- `fdd_findings`, `maintenance_tickets`, `maintenance_modes`

## API Design

Keep the browser API simple and stable:

- `GET /api/hierarchy`
- `GET /api/digital-twin`
- `GET /api/telemetry/stream`
- `GET /api/alarms/stream`
- `GET /api/trends`
- `POST /api/trends/snapshot`
- `GET /api/devices`
- `POST /api/devices/provision`
- `GET /api/schedules`
- `GET /api/schedules/effective`
- `GET /api/holiday-schedules`
- `GET /api/special-events`
- `GET /api/ai/optimization`
- `GET /api/ai/smart-grid`
- `POST /api/ai/control/iterate`
- `GET /api/edge/health`
- `GET /api/bacnet/discovery`
- `POST /api/edge/read-point`
- `POST /api/edge/write-point`
- `POST /api/edge/subscribe-cov`

Use API versioning for enterprise integrations:

- `GET /api/v1/status`
- `POST /api/v1/auth/login`
- `GET /api/v1/openapi.json`
- `GET /api/v1/audit-events`

## Edge Design

The backend should not directly encode BACnet packets. Keep that logic in the C++ edge core.

Node.js calls:

- `DiscoverDevices`
- `ReadPoint`
- `WritePoint`
- `SubscribeCov`
- `GetEnergyForecast`

The edge core owns:

- BACnet/IP socket setup
- BVLC framing
- Who-Is/I-Am discovery
- ReadProperty
- WriteProperty
- SubscribeCOV
- Simulator mode
- Safe writeback

## Scheduling Design

Use layered scheduling:

```text
global schedule
  < building schedule
    < zone schedule
      < device schedule
        < holiday schedule
          < special event
```

This supports:

- Daily schedules
- Monthly schedules
- Yearly schedules
- Holidays
- Temporary special events
- Device-specific overrides

## Alarm Design

Keep alarms event-oriented:

- `alarms` stores current alarm state.
- `alarm_logs` stores append-only alarm lifecycle events.
- SSE sends live alarm updates to the React UI.
- Audit events store administrative/security actions.

## Trend Logging Design

Trend logs persist selected device values from the live digital twin.

- `GET /api/trends` returns recent point samples for graphics, reports, and diagnostics.
- `POST /api/trends/snapshot` records the current digital twin values into `trend_logs`.
- `GET /api/reports/summary` returns report KPIs for trends, alarms, FDD, optimization, and export links.
- `GET /api/reports/trends.csv` exports trend history for reporting and external analytics.
- Trend records include building, zone, device, BACnet object type, object instance, metric, value, units, source, and timestamp.

## Real-Time Monitoring Design

The React UI monitors live operations through Server-Sent Events:

- Telemetry stream status
- Alarm stream status
- Latest BACnet/device point updates
- Online device count
- Active alarm count
- Trend logging readiness

The monitoring path is:

```text
BACnet device values -> C++ edge core -> Node API SSE -> React graphics -> MySQL trend logs
```

## AI and Analytics Design

The AI service should receive whole-building state:

- Zone temperatures
- Device values
- Setpoints and ranges
- Occupancy mode
- Weather
- Energy price
- Demand response state
- Grid price signal, current demand, demand limit, storage availability, and renewable availability
- Maintenance lockouts
- Existing RL policy

It should return:

- Recommended control actions
- Smart Grid AI demand response actions for HVAC, lighting, power, and storage
- Predicted energy impact
- Comfort impact
- Reward score
- Explainability notes

Persist:

- Optimization history
- RL Q-values
- Analytics events
- FDD findings

## Scalability Design

Small building:

- One edge core
- One Node API
- One MySQL database
- One React UI

Campus:

- Edge core per building or plant
- Shared Node API and MySQL tenant model
- Organization/site/building scoping
- Centralized alarms, users, reports, schedules, analytics

Enterprise:

- Multiple sites
- Session authentication and RBAC
- Remote management
- Health/watchdog checks
- Distributed edge gateways
- Central analytics and reporting
- Energy + IoT integration across smart buildings, airports, hospitals, and large campuses

## Smart Grid AI Design

Smart Grid AI coordinates energy and IoT systems without violating life-safety or security priorities.

Inputs:

- Grid signal: normal, elevated, demand response, or emergency
- Current demand and demand limit
- Electricity price and demand charge
- Renewable and storage availability
- Occupancy from security or access systems
- Fire/life-safety state
- HVAC zone comfort and equipment state
- Lighting and power meter state

Outputs:

- Demand risk
- Reserve margin
- Target kW reduction
- Recommended HVAC setpoint/load actions
- Recommended noncritical lighting actions
- Recommended power/load-shed actions
- Storage dispatch recommendation
- Fire/security/HVAC integration policy

Guardrails:

- Fire system always has life-safety priority.
- Security and occupancy inform scheduling and ventilation.
- HVAC remains comfort-bounded and maintenance-aware.

## Implementation Rule

Keep the system modular:

- React handles graphics and operator workflows.
- Node.js handles Web API, auth, orchestration, persistence, and SSE.
- Python handles optimization and simulation.
- C++ handles BACnet and real-time edge control.
- MySQL handles durable enterprise state.
