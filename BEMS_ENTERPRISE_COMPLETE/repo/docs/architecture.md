# BEMS Architecture

## System Overview

This repository implements an AI-driven Building Management and Energy Management System (BMS/BEMS) for edge deployment. The platform combines a C++ edge control core, Node.js application API, Python AI optimization service, React operator dashboard, MySQL persistence, Docker deployment, and Yocto packaging for i.MX93-class hardware.

The target appliance profile is:

- **Edge AI Gateway**
- **Smart Building Controller**
- **IoT Edge Compute Appliance**

The platform is optimized for Digi ConnectCore i.MX93 EVK style deployments, while remaining runnable as a local or site-server Docker Compose stack.

## Repository Layout

```text
repo/
  ai-service/        Python whole-building AI optimizer
  database/          MySQL schema
  docker/            Docker Compose stack and database init schema
  docs/              Architecture, SDD, SDP, UML artifacts
  edge-core/         C++ BACnet/control/energy core
  node-api/          Node.js REST, SSE telemetry/alarm streams, watchdog, remote API
  proto/             gRPC contracts for AI service and edge core
  ui/                React dashboard
  yocto/             i.MX93 Yocto integration layer
  .github/           CI workflow
```

## Runtime Architecture

```text
Browser / React UI
  | HTTP/JSON
  | SSE alarms
  | SSE telemetry
  v
Node.js API
  | MySQL queries          -> MySQL Database
  | gRPC optimization      -> Python AI Service
  | optional gRPC          -> C++ Edge Core
                                |
                                v
                          BACnet/IP Field Devices
```

## Architecture Layers

### Presentation Layer

Implemented in `ui/src/App.jsx`.

- React/Vite dashboard
- Recharts live telemetry charts
- Alarm console with acknowledge and clear actions
- Scheduling console with enable and disable actions
- Device commissioning table
- Device setpoint and range configuration
- Interactive floorplan editor persisted in browser `localStorage`
- Digital twin visualization with clickable device overlays
- Alarm stream over Server-Sent Events
- Telemetry stream over Server-Sent Events

### Application Layer

Implemented in `node-api/server.js`.

- Express REST API
- MySQL access through `mysql2`
- SSE alarm stream at `/api/alarms/stream`
- SSE telemetry stream at `/api/telemetry/stream`
- Digital twin generation
- Device provisioning and commissioning
- Schedule, alarm, role, user, analytics, and building hierarchy endpoints
- Autonomous mode evaluation
- Device-level and building-level optimization orchestration
- Watchdog and health endpoints
- Remote management intent endpoints

### AI Service Layer

Implemented in `ai-service/app.py`.

- Standard-library Python HTTP service on port `8000`
- `GET /health`
- HTTP fallback endpoints: `POST /optimize`, `POST /feedback`
- gRPC service: `bems.ai.v1.AiOptimizationService` on port `50052`
- Whole-building multi-zone optimization
- In-memory reinforcement-learning Q-value state
- Cost, comfort, and energy objective scoring

The Node.js API calls this service over gRPC when `AI_GRPC_ENDPOINT` is configured. HTTP through `AI_SERVICE_URL` remains available for health checks and fallback operation. If the service is unavailable, the Node API keeps a local optimization fallback.

### Service Contract Layer

Defined in `proto/edge_service.proto` and `proto/ai_service.proto`.

The Node.js clients are:

- `node-api/edgeClient.js` for the C++ edge-core gRPC contract
- `node-api/aiClient.js` for the Python AI gRPC contract

Current edge-core RPC contract:

- `Health`
- `ListDevices`
- `DiscoverDevices`
- `ReadPoint`
- `WritePoint`
- `GetEnergyForecast`

The Node API only calls the C++ edge service when `EDGE_GRPC_ENDPOINT` is set. Without that environment variable, `edgeClient.js` uses local fallback responses so the API and UI remain runnable in Docker.

Current AI-service RPC contract:

- `Health`
- `Optimize`
- `Feedback`

### Core Layer

Implemented in `edge-core/src`.

- C++ edge runtime
- BACnet/IP UDP networking boundary
- BACnet Who-Is / I-Am discovery path
- Confirmed ReadProperty path
- Confirmed WriteProperty path
- Device refresh logic
- Energy forecast logic
- Safe writeback strategy with clamping and rollback behavior
- Runtime facade for future gRPC server integration

### Field Layer

The field layer is represented by BACnet/IP devices on the building network.

- BACnet/IP over UDP port `47808`
- Analog and binary object support in the edge abstraction
- Device instance, object type, and object instance addressing
- FreeRTOS-based BACnet field devices are the target field-device profile

## C++ Design Patterns and SOLID Boundaries

The edge core is intentionally modular.

- **Facade**: `EdgeRuntime` coordinates polling, discovery, analytics, and writeback.
- **Adapter**: `BacnetStackClient` adapts the C-compatible BACnet boundary to `IBacnetClient`.
- **Strategy**: `SafeWritebackController` owns write safety, clamping, verification, and rollback.
- **Interface segregation**: discovery, BACnet client behavior, and writeback behavior are separate interfaces.
- **Dependency inversion**: runtime code depends on `IBacnetClient`, `IDeviceDiscovery`, and `IWritebackController`.
- **Single responsibility**: BACnet networking, device management, discovery, energy logic, and writeback are split into focused modules.

Key files:

- `edge-core/src/edge_runtime.*`
- `edge-core/src/bacnet_client.*`
- `edge-core/src/bacnet_interface.*`
- `edge-core/src/discovery_service.*`
- `edge-core/src/device_manager.*`
- `edge-core/src/writeback_controller.*`
- `edge-core/src/energy_ai.*`

## BACnet/IP Integration

The C++ edge core contains the real BACnet/IP integration path in `edge-core/src/bacnet_interface.cpp`.

Implemented:

- UDP socket initialization
- BACnet/IP BVLC framing
- NPDU/APDU request construction
- Targeted Who-Is broadcast
- I-Am response parsing
- Confirmed ReadProperty request for `present-value`
- Confirmed WriteProperty request for `present-value`
- Analog and binary object type mapping through the higher-level C++ client

Node.js routes discovery requests through `edgeClient.js`:

- `GET /api/bacnet/discovery`
- `POST /api/provisioning/discover`

When `EDGE_GRPC_ENDPOINT` is not configured, discovery returns a local fallback response and explains that edge gRPC must be enabled for live BACnet discovery.

Planned BACnet extensions:

- Full object-list point discovery heuristics
- AHU-to-VAV discovery
- VAV-to-zone mapping
- Vendor-specific metadata enrichment
- BACnet security hardening beyond network segmentation and deployment controls

## Digital Twin and Telemetry

The digital twin is generated by the Node API from MySQL building, zone, and device records.

Implemented endpoints:

- `GET /api/digital-twin`
- `GET /api/telemetry/stream`

The twin contains:

- Appliance identity
- Buildings
- Zones
- Zone geometry
- Devices
- BACnet instance/object metadata
- Device value, units, status, provisioning state, and commissioning state
- Device overlay coordinates
- Summary counts

The React UI renders the twin as an interactive building layout. Device overlays are clickable and open the device control/configuration workflow.

## AI Optimization

The system has two optimization paths:

- Python AI service primary path, enabled by `AI_SERVICE_URL`
- Node.js fallback path inside `server.js`

Implemented endpoints:

- `GET /api/autonomous-mode/profiles`
- `GET /api/autonomous-mode/evaluate`
- `POST /api/autonomous-mode/evaluate`
- `GET /api/ai/optimization`
- `GET /api/ai/building-optimization`
- `POST /api/ai/reinforcement/feedback`

Autonomous mode can select:

- **Conservative**
- **Normal**
- **Aggressive**

Inputs used by the current implementation:

- Time of day
- Day of week
- Occupancy state
- Academic calendar state
- Residential pattern
- Weather condition
- Demand response event state

The Python service optimizes a whole-building objective:

- Energy reduction
- Comfort protection
- Cost reduction

The reinforcement-learning implementation is currently in-memory. Persisted RL model state is a future extension.

## Application API Surface

Implemented major API groups:

- Buildings: `GET /api/buildings`
- Zones: `GET /api/buildings/:buildingId/zones`
- Zone devices: `GET /api/zones/:zoneId/devices`
- Devices: `GET /api/devices`, `GET /api/devices/:deviceId`
- Device provisioning: `POST /api/devices/provision`
- Device configuration: `PATCH /api/devices/:deviceId/configuration`
- Setpoint and range: `PATCH /api/devices/:deviceId/setpoint`, `PATCH /api/devices/:deviceId/range`
- Commissioning: `PATCH /api/devices/:deviceId/provision`, `PATCH /api/devices/:deviceId/commission`
- Hierarchy: `GET /api/hierarchy`
- Digital twin: `GET /api/digital-twin`
- Telemetry: `GET /api/telemetry/stream`
- Alarms: `GET /api/alarms`, `POST /api/alarms`, `PATCH /api/alarms/:alarmId/ack`, `PATCH /api/alarms/:alarmId/clear`
- Alarm stream: `GET /api/alarms/stream`
- Schedules: `GET /api/schedules`, `POST /api/schedules`, `PATCH /api/schedules/:scheduleId`, enable, disable, delete
- Roles: `GET /api/roles`
- Users: `GET /api/users`, `POST /api/users`, `PATCH /api/users/:userId/role`, `DELETE /api/users/:userId`
- Analytics: `GET /api/analytics/summary`, `POST /api/analytics/events`
- Edge: `GET /api/edge/health`, `GET /api/energy/forecast`, `POST /api/edge/read-point`, `POST /api/edge/write-point`, `GET /api/bacnet/discovery`
- Provisioning: `POST /api/provisioning/discover`, `GET /api/provisioning/status`
- Health: `GET /api/health`, `GET /api/watchdog`
- Remote management: `GET /api/remote/status`, `POST /api/remote/restart`, `POST /api/remote/update`, `POST /api/remote/watchdog/run`

Remote management endpoints can be protected with `BEMS_MANAGEMENT_TOKEN` and the `X-Management-Token` request header.

## Data Model

The MySQL schema is defined in:

- `database/schema.sql`
- `docker/init/schema.sql`

Main tables:

- `buildings`
- `zones`
- `devices`
- `roles`
- `users`
- `schedules`
- `alarms`
- `analytics_events`
- `building_optimization_runs`

The core hierarchy is:

```text
Building
  -> Zone
     -> Device
        -> BACnet object metadata
```

Device records include:

- `bacnet_instance`
- `object_instance`
- `object_type`
- vendor and model
- IP address
- present value
- units
- status
- provisioning and commissioning flags
- JSON configuration with setpoint and min/max range

## Deployment Architecture

Docker Compose lives in `docker/docker-compose.yml`.

Services:

- `api`: Ubuntu 24.04 Node.js backend, port `3000`
- `ui`: Ubuntu 24.04 React/Vite dashboard, port `5173`
- `ai-service`: Ubuntu 24.04 Python optimizer, HTTP port `8000`, gRPC port `50052`
- `db`: MySQL 8 database

Health checks:

- API: `GET /api/health`
- UI: HTTP check on port `5173`
- AI service: `GET /health`
- MySQL: `mysqladmin ping`

Useful local URLs:

- UI: `http://localhost:5173`
- API health: `http://localhost:3000/api/health`
- Watchdog: `http://localhost:3000/api/watchdog`
- Digital twin: `http://localhost:3000/api/digital-twin`
- Telemetry SSE stream: `http://localhost:3000/api/telemetry/stream`
- Python AI health: `http://localhost:8000/health`
- Python AI gRPC: `localhost:50052`

## Edge and Yocto Deployment

The Yocto layer is under `yocto/meta-bems`.

Implemented artifacts:

- `recipes-bems/edge-core/edge-core.bb`
- `recipes-bems/node-api/node-api.bb`
- `edge-core/packaging/bems-edge-core.service`

The edge core can bind a specific BACnet interface with:

```text
BACNET_LOCAL_IP=<interface-ip>
```

Without `BACNET_LOCAL_IP`, the edge core binds `0.0.0.0`.

## CI

The CI workflow is defined in `.github/workflows/ci.yml`.

It checks:

- C++ CMake configure and build
- Node API syntax
- Python AI service syntax
- UI dependency install
- UI production build

## Enterprise BMS Alignment

This project targets the same operational class as enterprise BMS stacks while keeping the implementation open and modular.

Implemented alignment:

- BACnet/IP discovery and communication path
- Device provisioning and commissioning
- Alarms and live alarm updates
- Schedules
- Digital twin visualization
- Floorplan editor
- Live telemetry charts
- Analytics events
- AI optimization engine
- Watchdog and health checks
- Remote management intent API
- Containerized deployment
- i.MX93 edge packaging path

Not yet implemented as full production subsystems:

- Persistent RL model storage
- Full BACnet object-list point discovery
- AHU/VAV/zone auto-mapping
- Maintenance ticketing integration
- Full FDD rule library
- VPN/ACL automation
- Multi-tenant enterprise RBAC enforcement beyond the current role/user schema

## Verification Snapshot

The current project has been verified with:

```bash
node --check repo/node-api/server.js
python3 -m py_compile repo/ai-service/app.py
cmake --build /tmp/bems-edge-build
npm run build
docker-compose up --build -d
```

The Docker stack starts with healthy `api`, `ui`, `db`, and `ai-service` containers.
