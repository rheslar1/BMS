# BEMS Enterprise Complete Implementation Guide

## Purpose

`BEMS_ENTERPRISE_COMPLETE` is a full-stack edge Building Management and Energy Management System. It combines a browser operator interface, Node.js application API, gRPC service boundary, C++ BACnet/IP edge core, Python AI optimization service, MySQL persistence, Docker deployment, and Yocto packaging.

This guide maps the implementation to the system diagrams, data contracts, runtime flows, and deployment boundaries used by the project.

## Repository Map

| Capability | Implementation Path | Notes |
| --- | --- | --- |
| Operator dashboard | `ui/src/App.jsx` | React dashboard with live telemetry, alarm handling, device controls, digital twin, floorplan editing, and optimization views. |
| HTTP API and SSE streams | `node-api/server.js` | Express API for building hierarchy, alarms, telemetry, devices, schedules, analytics, provisioning, autonomous mode, and health. |
| Edge gRPC client | `node-api/edgeClient.js` | Node boundary to the C++ edge core. Falls back to local demo responses when `EDGE_GRPC_ENDPOINT` is not configured. |
| AI gRPC client | `node-api/aiClient.js` | Node boundary to the Python AI service. Supports gRPC optimization plus health/fallback behavior. |
| C++ edge runtime | `edge-core/src/edge_runtime.*` | Runtime facade for discovery, device refresh, analytics, safe writeback, and BACnet operations. |
| BACnet/IP stack boundary | `edge-core/src/bacnet_interface.*` | UDP/BVLC/NPDU/APDU integration for Who-Is, I-Am parsing, ReadProperty, and WriteProperty. |
| BACnet client adapter | `edge-core/src/bacnet_client.*` | C++ adapter that exposes BACnet operations through typed project interfaces. |
| Device registry | `edge-core/src/device_manager.*` | In-memory model for device identity, object metadata, state, and refresh behavior. |
| Discovery service | `edge-core/src/discovery_service.*` | Discovery orchestration for field devices. |
| Safe writeback | `edge-core/src/writeback_controller.*` | Strategy for clamping, verifying, and rolling back unsafe or failed device writes. |
| Energy analytics | `edge-core/src/energy_ai.*` | Forecasting and energy scoring hooks inside the edge core. |
| AI optimization service | `ai-service/app.py` | Python service with health, optimize, feedback, and in-memory reinforcement-learning state. |
| Service contracts | `proto/edge_service.proto`, `proto/ai_service.proto` | gRPC contracts shared by the Node API, edge core boundary, and AI service. |
| Database schema | `database/schema.sql` | Building, zone, device, telemetry, alarm, schedule, and user/role persistence. |
| Docker stack | `docker/docker-compose.yml` | Local/site deployment for API, UI, AI service, database, and supporting services. |
| Yocto packaging | `yocto/` | Edge image integration path for embedded Linux deployment. |

## Runtime Sequence

Source diagram: `docs/diagrams/bems-runtime-sequence.mmd`

The primary runtime path is:

1. Browser UI sends a request, command, or configuration action to the Node.js API.
2. Node.js API returns immediate HTTP/JSON responses for request/response interactions.
3. Node.js API streams telemetry and alarm updates back to the browser through SSE.
4. Node.js API calls the C++ edge core through gRPC when `EDGE_GRPC_ENDPOINT` is configured.
5. C++ edge core performs BACnet/IP read/write operations against building field devices.
6. BACnet/IP field devices return present values, write acknowledgements, errors, or discovery responses.

The fallback behavior is intentional: the Node API remains runnable without an attached edge core, which keeps demos, UI development, and CI practical.

## Layered Architecture

Source diagram: `docs/diagrams/bems-layered-architecture.mmd`

| Layer | Responsibility | Primary Code |
| --- | --- | --- |
| Presentation | Operator workflow, dashboard state, live updates, control actions, alarm handling, digital twin visualization. | `ui/src/App.jsx` |
| Application | REST endpoints, SSE streams, MySQL queries, authorization-oriented user/role data, commissioning workflows, orchestration. | `node-api/server.js` |
| Service | gRPC contracts and client adapters between Node.js, C++ edge core, and Python AI service. | `proto/`, `node-api/edgeClient.js`, `node-api/aiClient.js` |
| Core | BACnet/IP integration, edge device model, safe writeback, analytics, energy forecasting, runtime facade. | `edge-core/src/` |
| Field | BACnet/IP devices, target FreeRTOS field-node profile, EEPROM-backed configuration, physical points. | External BACnet/IP devices plus future field-node firmware |

## Data Model

Source diagram: `docs/diagrams/bems-data-model.mmd`

The project data model centers on buildings, zones, devices, telemetry, and alarms.

| Entity | Key Fields | Purpose |
| --- | --- | --- |
| `Building` | `building_id`, `name`, `address`, `description` | Top-level physical site or campus structure. |
| `Zone` | `zone_id`, `building_id`, `name`, `description` | Logical control area within a building. |
| `Device` | `device_id`, `zone_id`, `name`, `type`, `bacnet_instance`, `object_type`, `vendor`, `model`, `ip_address`, `present_value`, `units`, `status`, `description` | BACnet or modeled device/point controlled by the edge system. |
| `Alarm` | `id`, `message` | Operator-visible abnormal condition. |

Core cardinality:

- One building has many zones.
- One zone has many devices.
- Alarms are event records that can reference device, zone, or system conditions depending on API/schema evolution.

## API And Service Boundary

The Node API owns the public application boundary:

- Browser-to-API transport: HTTP/JSON plus SSE.
- API-to-edge transport: gRPC through `edgeClient.js`.
- API-to-AI transport: gRPC through `aiClient.js` and HTTP fallback paths.
- API-to-database transport: MySQL through `mysql2`.

The C++ edge core should remain isolated from browser and database concerns. Its responsibility is deterministic field I/O, edge analytics, and safe writeback. This keeps BACnet timing, socket behavior, and device safety separate from presentation and persistence concerns.

## C++ Edge Core Design

The edge core uses familiar embedded C++ boundaries:

| Pattern | Implementation | Why It Matters |
| --- | --- | --- |
| Facade | `EdgeRuntime` | Gives Node/gRPC integration a small control surface. |
| Adapter | `BacnetStackClient` and BACnet interface layer | Keeps C-compatible BACnet/IP packet handling behind typed C++ methods. |
| Strategy | `SafeWritebackController` | Makes write policy explicit and testable. |
| Repository-style manager | `DeviceManager` | Centralizes device state and avoids scattered mutable device maps. |
| Dependency inversion | Runtime depends on client/discovery/writeback abstractions | Allows simulator, test, and real BACnet backends. |

Important safety behavior:

- Clamp outgoing setpoints to configured bounds.
- Verify writeback results where available.
- Preserve rollback behavior for failed or unsafe writes.
- Keep discovery and point refresh separate from operator commands.
- Prefer degraded/fallback responses over crashing the Node API when the edge core is unavailable.

## BACnet/IP Field Integration

The BACnet/IP path is implemented in `edge-core/src/bacnet_interface.cpp`.

Implemented integration responsibilities:

- UDP socket setup.
- BACnet/IP BVLC framing.
- NPDU/APDU request construction.
- Who-Is discovery request path.
- I-Am response parsing.
- ReadProperty for `present-value`.
- WriteProperty for `present-value`.
- Analog and binary object typing at the client boundary.

Recommended hardware validation additions:

- Capture a known-good Who-Is/I-Am exchange with Wireshark.
- Validate ReadProperty against one analog input, one analog value, and one binary value.
- Validate WriteProperty against a safe simulated point before any live actuator.
- Record failed-device, timeout, malformed packet, and offline network behavior.

## AI Optimization Flow

The AI service has two roles:

- Whole-building optimization across zones and device state.
- Feedback ingestion for reinforcement-learning style policy improvement.

The Node API should treat the AI service as advisory. Final actuator writes should still pass through the edge-core safety/writeback policy.

Operational rule:

1. AI recommends a setpoint or policy adjustment.
2. Node API validates the recommendation at the application level.
3. Edge core clamps and validates the final BACnet write.
4. Telemetry and alarm evidence are emitted for operator review.

## Deployment Model

| Deployment Mode | Expected Use |
| --- | --- |
| Local Docker Compose | Development, demo, API/UI integration, database-backed workflows. |
| Site server | Pilot deployment where BACnet/IP network access is routed to the edge core. |
| Embedded Linux / Yocto image | Production edge gateway deployment on i.MX93-class hardware. |

The Yocto layer should package:

- Edge core binary and systemd service.
- Node API runtime and service unit or container runtime.
- UI static bundle.
- AI service container or native Python environment.
- Network configuration for BACnet/IP access.
- OTA update hooks from the broader BEMS/OTA project set.

## Validation Matrix

| Test Area | Command Or Evidence | Acceptance Criteria |
| --- | --- | --- |
| Node API syntax | `node --check node-api/server.js` | Server file parses cleanly. |
| Node API package | `npm test` or route smoke tests in `node-api/` | API starts and exposes health endpoints. |
| UI build | `npm run build` in `ui/` | Vite build succeeds and dashboard bundle is emitted. |
| Edge core build | `cmake -S edge-core -B edge-core/build && cmake --build edge-core/build` | C++ sources compile. |
| AI service syntax | `python -m py_compile ai-service/app.py` | Python service parses cleanly. |
| Database schema | `mysql` import or container init | Schema loads without SQL errors. |
| gRPC contract | Regenerate stubs from `proto/*.proto` | Client/server stubs match checked-in contract. |
| BACnet lab test | Packet capture plus test device | Discovery, read, and safe writeback verified. |
| SSE behavior | Browser or curl stream check | Telemetry and alarm streams stay open and send well-formed events. |

## Implementation Backlog

1. Add automated route smoke tests for the Node API.
2. Add C++ unit tests for BACnet frame construction, parsing, write clamping, and rollback behavior.
3. Add generated gRPC server implementation for the C++ edge core if it is not already wired into the runtime binary.
4. Persist AI feedback/Q-state instead of keeping it only in memory.
5. Add a hardware validation folder with BACnet packet captures, lab notes, and target device metadata.
6. Connect the Yocto package to signed OTA update flow and systemd health watchdogs.
7. Add production commissioning workflow for building/zone/device import and BACnet object discovery.
