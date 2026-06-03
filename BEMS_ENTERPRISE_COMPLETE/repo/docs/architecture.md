# IntelliBuild Energy

## Software Architecture Document

| Field | Value |
| --- | --- |
| Document | IntelliBuild Energy Enterprise BMS/BEMS Architecture |
| Platform | React UI, Node.js Web API, MySQL, Python AI Service, C++ Edge Core, BACnet/IP |
| Deployment Target | Ubuntu 22.04 containers and Digi ConnectCore i.MX93-class embedded Linux |
| Live Update Transport | Server-Sent Events only; WebSockets are not used |
| Runtime Style | Event-driven architecture with HTTP commands, domain events, Kafka/RabbitMQ/MQTT event publication, and SSE browser projections |
| Edge Protocols | RabbitMQ AMQP command queue from Node.js to edge/nRF52840 field-device workers, BACnet/IP and BACnet MS/TP/EIA-485 to field devices |
| Field Readiness Goal | Real buildings, BACnet devices, dashboards, storage, alarms, analytics, HVAC, lighting, power monitoring, energy optimization, and embedded deployment |

# IntelliBuild Energy Architecture

## System Overview

IntelliBuild Energy implements an AI-driven Building Management and Energy Management System (BMS/BEMS) for edge deployment. The platform combines HVAC control, lighting supervision, power monitoring, and energy optimization in one operator platform. It uses a C++ edge control core, Node.js application API, Python AI optimization service, React operator dashboard, MySQL persistence, Docker deployment, and Yocto packaging for i.MX93-class hardware.

The implementation is intended for commercial smart-building deployments where operators need real BACnet/IP connectivity, live dashboards, persistent analytics, alarms, autonomous optimization, and an embedded hardware path. Its architecture is comparable in scope to enterprise BEMS/SCADA platforms while remaining a modular project built from C++, Node.js, Python, React, MySQL, Docker, and Yocto components.

The target appliance profile is:

- **Edge AI Gateway**
- **Smart Building Controller**
- **IoT Edge Compute Appliance**

The platform is optimized for Digi ConnectCore i.MX93 EVK style deployments, while remaining runnable as a local or site-server Docker Compose stack.

Conceptually, this is a modern scalable implementation of the BACnet/BMS architecture: BACnet remains the field protocol and device integration layer, while the platform adds analytics, AI optimization, remote management, enterprise administration, and containerized deployment around that core. The result is closer to a full smart-building operations platform than a single BACnet gateway.

The platform uses BACnet architecture internally for device discovery, object modeling, telemetry, command writeback, schedules, alarms, and controller-to-server communication. Above that BACnet foundation it adds:

- Enterprise UI for operators, admins, service teams, and multi-site users
- Analytics for energy, alarms, FDD, optimization history, trends, and reporting
- Cloud-style integration through HTTP APIs, session/RBAC security, remote management endpoints, watchdog health, and container deployment
- Scalability from a single building with one edge appliance to large campuses with distributed controllers, multiple buildings, shared analytics, and centralized administration
- Smart Grid AI for demand response, peak avoidance, price-aware scheduling, mixed HVAC/power optimization, and renewable/storage context
- Energy + IoT integration for smart buildings, energy-focused facilities, airports, hospitals, and large campuses

## Repository Layout

```text
repo/
  ai-service/        Python whole-building AI optimizer
  database/          MySQL schema
  docker/            Docker Compose stack and database init schema
  docs/              Architecture, SDD, SDP, UML artifacts
  edge-core/         C++ BACnet/control/energy core
  field-device/      C++ bare-metal BACnet field-device firmware target and simulator harness
  node-api/          Node.js Web API, SaaS admin, SSE telemetry/alarm streams, watchdog, remote API
  proto/             gRPC contract for the AI service
  ui/                React dashboard
  yocto/             i.MX93 Yocto integration layer
  .github/           CI workflow
```

Additional design notes:

- `docs/bacnet-ecostruxure-system-diagram.md`: full BACnet + enterprise BMS system diagram
- `docs/bacnet-135-2020-conformance.md`: BACnet Standard 135-2020 conformance profile, supported services, object scope, and certification checklist
- `docs/bems-backend-design.md`: backend design guide for the Node.js, MySQL, AI, edge, and BACnet service boundaries
- `docs/device-architecture.md`: field-device firmware architecture, normalized object model, device persistent storage, EEPROM setpoint storage, nRF52840 BACnet devices, and 5-in-1 power meter profiles
- `docs/database-schema.md`: real BMS/BEMS schema design for hierarchy, BACnet objects, scheduling, alarms, trends, analytics, security, and maintenance

## Runtime Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Operator Browser                            │
│  React UI: login, dashboard, alarms, schedules, floorplan, twin      │
└───────────────┬───────────────────────────────┬─────────────────────┘
                │ HTTP/JSON commands            │ SSE telemetry/alarms
                ▼                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Node.js Web API                              │
│  Auth/RBAC, tenant context, REST API, SSE streams, orchestration      │
└───────┬───────────────────┬───────────────────────────────┬─────────┘
        │ SQL               │ gRPC                           │ RabbitMQ AMQP edge commands
        ▼                   ▼                                ▼
┌───────────────┐   ┌──────────────────┐             ┌────────────────┐
│ MySQL 8       │   │ Python AI Service│             │ C++ Edge Core  │
│ config, alarms│   │ optimizer, RL,   │             │ Edge/nRF52840  │
│ analytics, RL │   │ digital-twin sim │             │ BACnet runtime │
└───────────────┘   └──────────────────┘             └───────┬────────┘
                                                               │ BACnet/IP UDP 47808
                                                               │ BVLC + NPDU/APDU
                                                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BACnet/IP Network                            │
│ Who-Is/I-Am discovery, ReadProperty, WriteProperty, SubscribeCOV      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           HVAC Devices                               │
│ AHUs, VAVs, dampers, fans, lights, meters, sensors, actuators         │
└─────────────────────────────────────────────────────────────────────┘
```

```text
Enterprise / Supervisory Layer
  -> BMS/BEMS SaaS software GUI
  -> WebStation-style browser access
  -> Analytics platforms and cloud dashboards
  -> Remote management, service workflows, audit, users, roles, sites
  -> Comparable role to EcoStruxure Building Operation supervisory services

Field Bus / Connected Product View

BACnet/IP Ethernet
  -> BACnet controllers, supervisory devices, IP VAV/AHU controllers

BACnet MS/TP RS-485
  -> BACnet room controllers, VAV boxes, fan-coil controllers
  -> Reaches the edge platform through the implemented EIA-485 BACnet MS/TP serial adapter or a BACnet/IP router

Modbus RTU RS-485
  -> Power meters, VFD drives, smart breakers, legacy equipment
  -> Reaches the building model through a protocol gateway/adapter

Field-selectable power meter communication
  -> 5-in-1 power meter profile with BACnet/IP, BACnet/IPv6, Modbus TCP, Modbus RTU over EIA-485, and REST API
  -> EIA-485 serial interface for serial meter wiring and Ethernet for BACnet/IP or Modbus TCP
  -> One configurable pulse output and two configurable pulse inputs for external meter totalizers or utility pulses

CAN bus
  -> Local appliance controllers, embedded drives, and equipment networks
  -> Reaches the edge core through SocketCAN-ready gateway/adapters

nRF52840 BACnet devices
  -> Temperature, room, lighting, occupancy, and small IO devices
  -> Wireless BLE/Thread/IEEE 802.15.4 bridge or wired BACnet MS/TP/EIA-485 adapter
  -> Exposes BACnet objects directly; bare-metal firmware model
```

Open protocol integration:

- Native BACnet support through BACnet/IP in the C++ edge core
- BACnet MS/TP integration through BACnet/IP routers and the implemented EIA-485 BACnet MS/TP serial adapter
- Modbus RTU integration through protocol adapters for meters, VFD drives, breakers, and legacy systems
- Field-selectable power meters with BACnet/IP, BACnet/IPv6, Modbus TCP, Modbus RTU over EIA-485, REST API, Ethernet, one configurable pulse output, and two configurable pulse inputs
- CAN integration path for equipment buses and embedded controller networks through gateway/adapters
- BACnet/IP as the main controller-to-server network for supervisory communication
- nRF52840 BACnet field devices for temperature, humidity, CO2, occupancy, lighting, and room IO over wireless or wired transport
- nRF52840 devices expose BACnet objects directly through wireless bridges or wired BACnet MS/TP/EIA-485 adapters for visualization, alarms, trends, schedules, and AI
- Multi-protocol translation from BACnet/IP, routed BACnet MS/TP, Modbus RTU, and CAN into HTTP/REST, Server-Sent Events, BACnet Web Services style JSON, and MQTT over TLS cloud streams
- Cloud connectivity hooks for MQTT brokers, Microsoft Azure IoT Hub, and AWS IoT Core through `MQTT_BROKER_URL`, `AZURE_IOT_HUB_HOSTNAME`, and `AWS_IOT_ENDPOINT`
- Local edge processing through the C++ edge core, Python AI service, deterministic Node.js fallback logic, and optional Node-RED, Edge Python, or Sedona function-block runtime integration
- Data standardization that converts field signals into the normalized building model: `Building -> Floor -> Room -> Zone -> Device -> BACnet Object -> present-value`
- Edge platform capability endpoint at `GET /api/edge/capabilities` for protocol translation, cloud connectivity, local edge processing, and normalized object support

Advanced WebStation-style UI:

- Browser-based dashboards
- Graphics for equipment such as AHUs, VAVs, chillers, pumps, fans, dampers, valves, lighting panels, and meters
- Digital twin and floorplan overlays for device context
- Alarm console and alarm logs
- Trend logging for persisted point samples and equipment history
- Energy dashboards for real-time power monitoring, demand control, and energy reports

Best-fit facility types:

- Smart buildings
- Energy-focused facilities
- Mixed HVAC + power facilities
- Airports
- Hospitals
- Large campuses
- Very large enterprise systems that need energy + IoT integration

Scalability model:

- Small building: one edge controller, local MySQL, simulator or direct BACnet/IP network, single operator UI
- Medium site: multiple floors, routed BACnet MS/TP trunks, Modbus meter gateways, distributed controllers
- Large campus: distributed edge appliances per building, centralized SaaS/admin view, shared analytics, remote management, and enterprise reporting

Real HVAC example:

```text
AHU temperature control

1. Sensor on BACnet MS/TP reads supply or zone temperature.
2. Routed BACnet/IP exposes that value as a BACnet Analog Input.
3. SmartX AS-P/AS-B style controller runs the PID loop.
4. Controller modulates the cooling valve through an Analog Output.
5. Edge core reads temperature with ReadProperty and can subscribe with SubscribeCOV.
6. Node API stores telemetry, raises alarms when values are out of range, and streams updates by SSE.
7. React WebStation-style UI displays the AHU graphic, temperature trend, valve command, alarms, and energy context.
8. AI optimization evaluates comfort, energy, price, and peak demand before recommending or applying approved setpoint changes.
```

Simplified data flow:

```text
Sensor -> Controller -> Server/API -> User Interface
  AI       Logic          DB          Graphics
```

## BACnet Communication Diagram

The BACnet implementation target is ANSI/ASHRAE Standard 135-2020. The project supports a BACnet/IP client subset for Who-Is/I-Am discovery, confirmed ReadProperty, confirmed WriteProperty, and SubscribeCOV request setup. Formal product conformance requires the PICS/certification work tracked in `docs/bacnet-135-2020-conformance.md`.

The architecture includes a BACnet Energy Services Interface implementation through B/WS-style endpoints. This allows an energy data client to access complex structured building information over web services even when the underlying building control network is not BACnet. IntelliBuild Energy normalizes BACnet/IP, Modbus RTU, CAN, simulator, trend-log, analytics, pricing, grid, and demand-response data into structured energy signal payloads.

```text
Node API                  RabbitMQ Edge Queue        C++ Edge Core / BACnet      Field Device
  |                            |                            |                         |
  | bacnet.discover_devices    |                            |                         |
  |--------------------------->|                            |                         |
  |                            | command event              |                         |
  |                            |--------------------------->| Who-Is, low/high inst. |
  |                            |                            |------------------------>|
  |                            |                            | I-Am                    |
  |                            | telemetry/provision event  |<------------------------|
  |<---------------------------|<---------------------------|                         |
  |                            |                            |                         |
  | bacnet.read_property       |                            |                         |
  |--------------------------->| command event              |                         |
  |                            |--------------------------->| ReadProperty present-value
  |                            |                            |------------------------>|
  |                            | ComplexACK value           |                         |
  |<---------------------------| telemetry event            |<------------------------|
  |                            |                            |                         |
  | bacnet.subscribe_cov       |                            |                         |
  |--------------------------->| command event              |                         |
  |                            |--------------------------->| SubscribeCOV            |
  |                            |                            |------------------------>|
  | subscribed                 | SimpleACK                  |                         |
  |<---------------------------| telemetry event            |<------------------------|
```

## Architecture Layers

### Presentation Layer

Implemented in `ui/src/App.jsx`.
- REACT Login page
- React dashboard
  - REACT device configuration page    
  - Admin page for SaaS operations
  - live telemetry charts
  - Alarm console with acknowledge and clear actions
  - Alarm log history for create, acknowledge, and clear events
-   Scheduling console with enable and disable actions
-   Device commissioning table
-   Device provisioning workflow with BACnet discovery intake
-   Device setpoint and range configuration
-   Device EEPROM configuration and retained setpoint storage metadata
-   Zone browser and device detail panel for maintenance operations
-   User maintenance controls for role assignment, activation, password reset, and deletion
-   Interactive floorplan editor persisted in browser `localStorage`
- Digital twin visualization with clickable device overlays
- Tailwind-backed professional operator styling with persisted light/dark mode
- Configurable alarm severity colors used by alarm tables and floorplan overlays
- Energy usage charts and scrollable live telemetry feed
- AI control panel for simulation and control-loop execution
- Reinforcement-learning policy panel
- BMS/BEMS SaaS software GUI for site, building, user, role, schedule, alarm, device, analytics, and AI operations
- Visualization through dashboard graphics, digital twin, floorplan overlays, device widgets, charts, and control panels
- Real-time monitoring console for SSE stream status, latest BACnet/device samples, active alarms, online devices, and trend readiness
- Alarm management through live alarm console, alarm logs, acknowledge/clear workflows, and SSE alarm updates
- Energy dashboards with KPI panels, trend charts, energy usage graphs, pricing/weather context, and optimization history
- Reporting implementation through persisted analytics events, alarm history, optimization history, FDD findings, report schedules, export history, heat maps, and audit events
- Remote access through browser-capable HTTP UI, session login, RBAC, watchdog, and remote management endpoints
- Alarm stream over Server-Sent Events
- Alarm logs for audit-friendly alarm state history
- Telemetry stream over Server-Sent Events
- building->zone(floor->room)->device hierarchy

### Application Layer

Implemented in `node-api/server.js` with authentication helpers in `node-api/auth.js`.

- Express HTTP/JSON Web API
- Versioned enterprise API under `/api/v1`
- Login/session endpoint for the UI at `/api/v1/auth/login`
- OpenAPI document at `/api/v1/openapi.json`
- Tenant context through organization and site headers
- User authentication with salted `scrypt` password hashes
- Session-token authorization through `X-Session-Token`
- Role permission checks for admin and mutating API actions
- User and role management endpoints for RBAC administration
- SaaS admin summary endpoint for organizations, sites, users, roles, features, and audit activity
- MySQL access through `mysql2`
- SSE alarm stream at `/api/alarms/stream`
- SSE telemetry stream at `/api/telemetry/stream`
- Digital twin generation
- Device provisioning and commissioning
- Schedule, alarm, role, user, analytics, and building zone hierarchy endpoints where each zone is represented by a floor/room path
- Autonomous mode evaluation
- Device-level and whole-building optimization orchestration
- AI control API for global-state collection, decision generation, optional writeback, reward calculation, and policy update
- Predictive simulation API for testing optimization actions before applying them to real devices
- Weather, pricing, and airflow graph context APIs for smarter commercial building control
- Watchdog and health endpoints
- Remote management intent endpoints

The UI and external clients use HTTP/JSON for commands and Server-Sent Events for live updates. WebSockets are intentionally not used.

### Event-Driven Runtime

The system is event-driven. HTTP/JSON commands, edge polling, AI decisions, alarms, analytics, demand-response calculations, and footprint calculations publish domain events into the Node.js event bus. Kafka is the local/backend event bus for service integration and downstream consumers. RabbitMQ AMQP is the default edge command queue for BACnet writes, COV subscriptions, OTA commands, nRF52840 field-device commands, background processing, and durable command fanout. MQTT over TLS is the cloud bridge for secure telemetry and alert publication to IoT ecosystems such as Azure IoT Hub, AWS IoT Core, or a site MQTT broker. Browser real-time projections remain Server-Sent Events only.

Core event and command flow:

```text
BACnet/Modbus/CAN/AI/API event source
  -> Node API domain event
  -> Kafka topic, RabbitMQ exchange, and optional MQTT/TLS topic
  -> SSE browser projection, audit/history storage, analytics, or cloud subscriber

HTTP command
  -> Node API validation/RBAC/audit
  -> RabbitMQ `bems.edge.commands` topic exchange
  -> Edge worker or nRF52840 field-device bridge
  -> BACnet WriteProperty, SubscribeCOV, OTA bootloader action, or local device command
```

Published event families include telemetry, live telemetry summaries, alarms, alarm snapshots, analytics, AI control events, AI simulation events, utility demand-response events, and building cost/carbon footprint events. The event topology is visible at `GET /api/events/status` and summarized in `GET /api/v1/status`.

Local control remains local-first: if Kafka, RabbitMQ, or MQTT is unavailable, the API keeps serving local UI/API workflows and logs transport errors while edge, scheduling, watchdog, deterministic fallback, and SSE paths continue.

At the enterprise layer, this application plays the same supervisory role as WebStation-style access, analytics dashboards, and BMS management applications. It gives operators a browser GUI for live building operation while exposing API surfaces for remote services, enterprise analytics, commissioning, and maintenance workflows.

### AI Service Layer

Implemented in `ai-service/app.py`.

- Standard-library Python HTTP service on port `8000`
- `GET /health`
- HTTP fallback endpoints: `POST /optimize`, `POST /feedback`
- gRPC service: `bems.ai.v1.AiOptimizationService` on port `50052`
- Whole-building multi-zone optimization
- In-memory reinforcement-learning Q-value state
- Reinforcement-learning policy hydration from Node/MySQL request payloads
- Cost, comfort, and energy objective scoring

The Node.js API calls this AI service over gRPC when `AI_GRPC_ENDPOINT` is configured. HTTP through `AI_SERVICE_URL` remains available for health checks and fallback operation. If the service is unavailable, the Node API keeps a local optimization fallback.

### Service Contract Layer

Defined in `proto/ai_service.proto` for AI optimization and RabbitMQ routing keys for edge orchestration.

The Node.js service clients and command transports are:

- RabbitMQ AMQP `bems.edge.commands` for edge/nRF52840 command delivery when `EDGE_COMMAND_TRANSPORT=rabbitmq`
- `node-api/edgeClient.js` for RabbitMQ C++ edge-core command queuing and event-driven read/write/COV requests
- `node-api/aiClient.js` for the Python AI gRPC contract

Current edge RabbitMQ command contract:

- `bacnet.discover_devices`
- `bacnet.read_property`
- `bacnet.read_property_multiple`
- `bacnet.write_property`
- `bacnet.subscribe_cov`
- `edge.energy_forecast`
- `nrf52840.ota_update`

The Docker deployment sets `EDGE_COMMAND_TRANSPORT=rabbitmq`, so Node.js queues edge and nRF52840 commands through RabbitMQ. Synchronous HTTP responses return queued status plus local fallback projections when needed; authoritative point updates arrive through telemetry, provisioning, and COV events.

Current AI-service RPC contract:

- `Health`
- `Optimize`
- `Feedback`

### Core Layer

Implemented in `edge-core/src`.

- C++ edge runtime
- RabbitMQ command-consumer boundary for queued edge/nRF52840 commands
- BACnet/IP UDP networking boundary
- BACnet Who-Is / I-Am discovery path
- Confirmed ReadProperty path
- Confirmed WriteProperty path
- Confirmed SubscribeCOV path for BACnet object change-of-value monitoring
- Optional simulated BACnet device bank for local demos, CI, and provisioning smoke tests
- Device refresh logic
- Energy forecast logic
- Safe writeback strategy with clamping and rollback behavior
- Runtime facade exposed through the RabbitMQ command boundary

### Field Layer

The field layer is represented by BACnet/IP devices on the building network.

- BACnet/IP over UDP port `47808`
- Analog and binary object support in the edge abstraction
- Device instance, object type, and object instance addressing
- BACnet field devices are bare-metal controllers; nRF52840 BACnet devices have bare-metal firmware
- Device firmware architecture is specified in `docs/device-architecture.md`
- BACnet MS/TP over RS-485 is a field-bus integration path through a BACnet router or the implemented edge-core EIA-485 BACnet MS/TP serial adapter
- Modbus RTU over RS-485 is an integration path for meters, drives, and legacy controllers through a protocol adapter
- CAN bus is an integration path for embedded equipment networks through SocketCAN-ready adapters
- nRF52840 BACnet devices can be integrated through wireless BLE/Thread/IEEE 802.15.4 bridges or wired BACnet MS/TP/EIA-485 adapters

Connected products at the field level include:

- Sensors for temperature, humidity, CO2, pressure, occupancy, and equipment status
- nRF52840 BACnet devices for temperature, occupancy, humidity, CO2, lighting, small IO, and room status over wireless or wired transport
- Actuators for valves, dampers, relays, fan stages, and lighting circuits
- Variable-frequency drives for fans and pumps
- Power meters for branch, panel, equipment, and whole-building measurement
- 5-in-1 field-selectable power meters with Ethernet/EIA-485 communication and pulse I/O expansion
- Smart breakers and controllable electrical distribution devices
- Smart building controllers such as Schneider SmartX AS-P/AS-B style controllers
- PLCs and programmable automation controllers for plant, electrical, and specialty equipment

These products expose BACnet objects such as analog inputs, analog outputs, analog values, binary inputs, binary outputs, and binary values. The edge core addresses each point by device instance, object type, object instance, and property. The current implementation reads and writes `present-value`, subscribes to COV changes, and keeps the higher-level UI/API independent from vendor-specific device details.

nRF52840 devices are treated as BACnet bare-metal devices. Each device exposes BACnet objects such as Analog Input for room temperature and Binary Input for occupancy. The transport may be wireless through BLE, Thread, or IEEE 802.15.4 bridge hardware, or wired through BACnet MS/TP or EIA-485 adapter hardware. Device metadata records the chipset, transport, firmware, BACnet object identity, and optional battery percentage in the device configuration JSON.

Battery-backed BACnet devices expose `batteryPercent` in device configuration. The API includes it in nRF52840 BACnet energy-service metadata, and the UI shows and edits the battery percentage in device details and configuration.

Power meters can use a field-selectable 5-in-1 communication profile. Meter telemetry may arrive over BACnet/IP, BACnet/IPv6, Modbus TCP, Modbus RTU over EIA-485, or REST API. The normalized model stores the selected protocol, serial/Ethernet interface, one pulse output, and two pulse inputs in device configuration while exposing demand, energy, and pulse-derived data as BACnet-style Analog Value/Input points.

Device architecture traceability:

| `docs/device-architecture.md` requirement | Project design reflection |
| --- | --- |
| BACnet bare-metal C++ field controllers | `GET /api/edge/capabilities` exposes `bacnet_bare_metal_field_devices`; seed data and migrations model field devices as BACnet devices; `field-device/CMakeLists.txt` builds the C++ firmware/simulator target; `field-device/include/field_device_firmware.h` defines C++ SOLID firmware interfaces |
| nRF52840 BACnet devices, wired or wireless | `nrf52840_bacnet_devices` capability, nRF52840 seed devices, and migrations `014`, `018`, and `020` store chipset, wired/wireless transport, BACnet identity, firmware, and battery percentage |
| Normalized BACnet object model | API/device schema stores device instance, object type, object instance, present value, units, status, and JSON configuration; UI device details show the same object identity |
| Persistent setpoints and schedules on device | `persistentStorage`, `setpointStorage`, and `bacnetScheduleStorage` are stored in device configuration; schedule create/update/enable/disable/delete syncs device-resident schedule metadata |
| OTA update for field devices | `POST /api/devices/:deviceId/ota-update` records signed firmware metadata, checksum/signature, A/B boot partition state, staged inactive slot, watchdog confirmation requirement, rollback policy, and schedule/setpoint retention |
| Battery percentage reporting | `batteryPercent` is seeded, migrated, exposed in energy-service metadata, and editable in provisioning/device configuration UI |
| Field-selectable power meters | 5-in-1 power meter seed/migration stores BACnet/IP, BACnet/IPv6, Modbus TCP, Modbus RTU over EIA-485, REST API, Ethernet, pulse output, and pulse inputs |
| Event-driven platform flow | Domain events publish through Kafka/RabbitMQ/MQTT while browser projections remain SSE; edge/nRF52840 commands queue through RabbitMQ |

The field-device C++ design mirrors the edge-core C++ style: narrow interfaces, strategy/facade/adapter/repository patterns, dependency inversion, and simulator-friendly boundaries for unit tests and hardware substitution.

BACnet object examples shown in graphics and device details:

- Temperature sensor -> BACnet Analog Input
- Fan command -> BACnet Binary Output
- Damper or valve command -> BACnet Analog Output
- Power meter demand/kWh -> BACnet Analog Input or Analog Value
- Schedule -> BACnet Schedule Object

BACnet/IP is used for controller-to-server communication from the edge core to IP controllers. BACnet MS/TP is treated as the field-device bus for room controllers and terminal units, typically routed into BACnet/IP before reaching the edge core. BACnet objects are the normalized point model exposed in graphics, charts, alarms, schedules, analytics, and AI optimization. The edge core supports ReadProperty for single point reads, ReadPropertyMultiple for same-device `present-value` batch reads, SubscribeCOV setup, and ConfirmedCOVNotification/UnconfirmedCOVNotification parsing into the telemetry event path.

BACnet mapping:

| Layer | Source |
| --- | --- |
| Building | Database |
| Floor | Database |
| Zone | Database |
| Room | Database |
| Device | BACnet Device Object plus database metadata |
| Points | BACnet Objects |

BACnet itself is flat: a device exposes objects. The BEMS adds enterprise context so those flat BACnet objects appear in a logical operator tree:

```text
Building -> Floor -> Zone -> Room -> Device -> Points
```

Controller-level functions include:

- Execute local HVAC sequences such as occupied/unoccupied mode, economizer logic, fan control, damper modulation, valve control, and safeties
- Handle first-line alarm generation and equipment interlocks close to the plant or zone
- Trend local point values for diagnostics and commissioning
- Execute schedules locally when configured in the controller or through mapped schedule objects
- Expose supervisory state, setpoints, alarms, and trends upstream to the edge platform through BACnet/IP or routed BACnet MS/TP

## C++ Design Patterns and SOLID Boundaries

The edge core is intentionally modular.

- **Facade**: `EdgeRuntime` coordinates polling, discovery, analytics, and writeback.
- **Adapter**: `BacnetStackClient` adapts the C-compatible BACnet boundary to `IBacnetClient`; Modbus RTU and CAN helpers adapt fieldbus frames behind `IFieldbusGateway`.
- **Strategy**: `SafeWritebackController` owns write safety, clamping, verification, and rollback.
- **Interface segregation**: discovery, BACnet client behavior, writeback behavior, and fieldbus behavior are separate interfaces.
- **Dependency inversion**: runtime code depends on `IBacnetClient`, `IDeviceDiscovery`, `IWritebackController`, and `IFieldbusGateway`.
- **Single responsibility**: BACnet networking, Modbus/CAN frame generation, device management, discovery, energy logic, and writeback are split into focused modules.

Key files:

- `edge-core/src/edge_runtime.*`
- `edge-core/src/bacnet_client.*`
- `edge-core/src/bacnet_interface.*`
- `edge-core/src/discovery_service.*`
- `edge-core/src/device_manager.*`
- `edge-core/src/writeback_controller.*`
- `edge-core/src/modbus_rtu_interface.*`
- `edge-core/src/canbus_interface.*`
- `edge-core/src/fieldbus_gateway.*`
- `edge-core/src/energy_ai.*`

## BACnet/IP Integration

The C++ edge core contains the real BACnet/IP integration path in `edge-core/src/bacnet_interface.cpp`.

The full-stack BACnet boundary is compatible with the SourceForge BACnet Protocol Stack at `https://sourceforge.net/projects/bacnet/`. That stack is a portable C BACnet library for embedded systems and operating systems, and it matches the project boundary because IntelliBuild Energy already exposes a C-compatible BACnet interface to the rest of the C++ edge runtime.

Implemented:

- UDP socket initialization
- BACnet/IP BVLC framing
- NPDU/APDU request construction
- Targeted Who-Is broadcast
- I-Am response parsing
- Confirmed ReadProperty request for `present-value`
- Confirmed WriteProperty request for `present-value`
- Confirmed SubscribeCOV request for object change-of-value notifications
- Analog and binary object type mapping through the higher-level C++ client
- Simulated BACnet devices behind the same discovery/read/write C boundary when `BACNET_SIMULATOR_ENABLED=true`

BACnet/IP services used by the platform:

| Service | Purpose | Current role |
| --- | --- | --- |
| Who-Is | Discover devices | Sent by the edge core for targeted device instance discovery |
| I-Am | Device discovery response | Parsed by the edge core to identify reachable BACnet devices |
| ReadProperty | Read point values | Used for `present-value` telemetry and device detail refresh |
| WriteProperty | Send commands | Used for safe writeback to setpoints, dampers, valves, fans, lighting, and other writable points |
| SubscribeCOV | Change-of-value monitoring | Optional path for lower-latency point change notifications |

Docker Compose enables the simulator by default so the full UI/API/gRPC/provisioning workflow can run without physical HVAC devices. The i.MX93 systemd service defaults `BACNET_SIMULATOR_ENABLED=false` so production deployments use real BACnet/IP unless the simulator is intentionally enabled.

Simulated device instances:

- `101`: Lobby temperature, analog input, Celsius
- `102`: Floor 1 VAV damper, analog output, Percent
- `103`: Floor 2 temperature, analog input, Celsius
- `201`: Floor 1 supply fan, binary output
- `250`: Occupancy schedule, BACnet schedule object
- `301`: Tower B lobby light, binary output
- `302`: Tower B damper, analog output, Percent

Node.js routes discovery requests through `edgeClient.js`:

- `GET /api/bacnet/discovery`
- `POST /api/provisioning/discover`
- `POST /api/edge/subscribe-cov`

Discovery requests are queued through RabbitMQ. Discovered devices and point updates return through provisioning, telemetry, and COV event projections.

Implemented BACnet extension surfaces:

- Object-list point discovery heuristics through `GET /api/bacnet/object-map`, built from discovered/provisioned BACnet object metadata.
- AHU-to-VAV and VAV-to-zone mapping through `GET /api/bacnet/equipment-map`, derived from device type/model naming and building hierarchy context.
- Vendor-specific metadata enrichment through `GET /api/bacnet/vendor-metadata`, grouping vendor/model/firmware/transport data for commissioning and support.
- BACnet security hardening is represented through deployment controls, RBAC-protected provisioning/writeback APIs, audit events, management-token protection, and segmented BACnet/edge network boundaries.

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

- Python AI service primary gRPC path, enabled by `AI_GRPC_ENDPOINT`
- Python AI service HTTP fallback path, enabled by `AI_SERVICE_URL`
- Node.js fallback path inside `server.js`

Implemented endpoints:

- `GET /api/autonomous-mode/profiles`
- `GET /api/autonomous-mode/evaluate`
- `POST /api/autonomous-mode/evaluate`
- `GET /api/ai/optimization`
- `GET /api/ai/building-optimization`
- `GET /api/ai/reinforcement/policy`
- `GET /api/ai/optimization-history`
- `POST /api/ai/reinforcement/feedback`
- `GET /api/ai/weather-pricing`
- `GET /api/ai/airflow-graph`
- `POST /api/ai/predictive-simulation`
- `POST /api/ai/decision-loop`
- `GET /api/ai/control/status`
- `POST /api/ai/control/iterate`
- `POST /api/ai/control/start`
- `POST /api/ai/control/stop`

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

Reinforcement-learning feedback is persisted by the Node.js API in MySQL as zone/action Q-values. The persisted policy is loaded before whole-building optimization and passed to the Python AI service so optimization can resume learned behavior after service restarts. Optimization runs are also stored in a formal history table for audit and analytics.

### Autonomous AI Control Loop

The Node.js API implements the operator-facing control loop that coordinates the AI service, digital twin, telemetry, and BACnet write path.

Loop sequence:

1. Collect all zone and device data from MySQL and the live digital twin.
2. Build a global building state with comfort, energy, peak-load, weather, pricing, and demand-response context.
3. Ask the AI optimizer for whole-building actions.
4. Run a predictive simulation and airflow graph pass before applying control.
5. Optionally apply approved setpoint actions through device configuration/writeback APIs.
6. Measure the updated building state.
7. Compute reward from comfort protection, energy reduction, and peak avoidance.
8. Persist reinforcement-learning feedback and optimization history.
9. Repeat continuously when the control loop is started.

The current decision engine is intentionally deterministic and auditable, with an upgrade path to ML models in the Python AI service. The airflow model is represented as a graph message-passing structure so it can be replaced by a graph neural network while preserving the API contract.

Control objectives:

- Keep occupied zones comfortable.
- Minimize energy usage.
- Avoid overload peaks and demand-response penalties.
- Preserve operator transparency through policy, reward, and simulation output.

## Application API Surface

Implemented major API groups:

- Enterprise Web API: `GET /api/v1/status`, `GET /api/v1/openapi.json`
- Authentication: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`
- SaaS administration: `GET /api/v1/admin/summary`
- Organizations and sites: `GET /api/v1/organizations`, `GET /api/v1/sites`
- Audit events: `GET /api/v1/audit-events`
- Buildings: `GET /api/buildings`
- Floors: `GET /api/buildings/:buildingId/floors`
- Rooms: `GET /api/floors/:floorId/rooms`
- Zones: `GET /api/buildings/:buildingId/zones`, `GET /api/rooms/:roomId/zones`; the visible zone path is `floor -> room`
- Zone devices: `GET /api/zones/:zoneId/devices`
- Devices: `GET /api/devices`, `GET /api/devices/:deviceId`
- Device provisioning: `POST /api/devices/provision`
- Device configuration: `PATCH /api/devices/:deviceId/configuration`
- Setpoint and range: `PATCH /api/devices/:deviceId/setpoint`, `PATCH /api/devices/:deviceId/range`
- Commissioning: `PATCH /api/devices/:deviceId/provision`, `PATCH /api/devices/:deviceId/commission`
- Hierarchy: `GET /api/hierarchy`
- Digital twin: `GET /api/digital-twin`
- Telemetry: `GET /api/telemetry/stream`
- Trend logging: `GET /api/trends`, `POST /api/trends/snapshot`
- Reporting: `GET /api/reports/summary`, `GET /api/reports/heat-map`, `GET /api/reports/export`, `GET /api/reports/exports`, `GET /api/reports/schedule-runs`, `GET /api/reports/trends.csv`, `GET /api/reports/energy.pdf`, `GET/POST/PATCH /api/reports/schedules`, `POST /api/reports/schedules/run-due`, `POST /api/reports/schedules/:scheduleId/run`
- Firmware OTA: `GET/POST /api/firmware/artifacts`, `GET /api/firmware/ota-jobs`, `POST /api/devices/:deviceId/ota-update`
- Alarms: `GET /api/alarms`, `GET /api/alarm-logs`, `POST /api/alarms`, `PATCH /api/alarms/:alarmId/ack`, `PATCH /api/alarms/:alarmId/clear`
- Alarm stream: `GET /api/alarms/stream`
- Schedules: `GET /api/schedules`, `GET /api/schedules/effective`, `POST /api/schedules`, `PATCH /api/schedules/:scheduleId`, enable, disable, delete
- Schedule recurrence: daily, monthly, and yearly schedule definitions
- Schedule override precedence: device schedules override zone schedules, zone schedules override building schedules, and building schedules override global schedules for matching action/window definitions
- Holiday schedules: `GET /api/holiday-schedules`, `POST /api/holiday-schedules`, `PATCH /api/holiday-schedules/:holidayId/disable`
- Special events: `GET /api/special-events`, `POST /api/special-events`, `PATCH /api/special-events/:eventId/disable`
- Schedule exceptions: `GET /api/schedules/effective` returns active holiday schedules and priority-based special event overrides with regular effective schedules
- Roles: `GET /api/roles`, `POST /api/roles`, `PATCH /api/roles/:roleId`, `DELETE /api/roles/:roleId`
- Users: `GET /api/users`, `POST /api/users`, `PATCH /api/users/:userId/role`, `PATCH /api/users/:userId/active`, `PATCH /api/users/:userId/password`, `DELETE /api/users/:userId`
- Analytics: `GET /api/analytics/summary`, `POST /api/analytics/events`
- AI control: `GET /api/ai/weather-pricing`, `GET /api/ai/airflow-graph`, `POST /api/ai/predictive-simulation`, `POST /api/ai/decision-loop`, `GET /api/ai/control/status`, `POST /api/ai/control/iterate`, `POST /api/ai/control/start`, `POST /api/ai/control/stop`
- Smart Grid AI: `GET /api/ai/smart-grid` for demand response, price signal, demand risk, load-shed actions, and fire/security/HVAC integration policy
- Utility demand response: `GET /api/ai/demand-response` for OpenADR-ready event metadata, dispatch planning, safety policy, and demand shed status
- Temperature trend prediction: `GET /api/ai/temperature-trends` using 30 days of trend history for zone thermal drift projections
- Operation optimization: `POST /api/ai/optimize-operation` combines physics simulation, demand response planning, digital twin context, and the AI control loop
- FDD: `GET /api/fdd/findings`, `POST /api/fdd/analyze`
- Maintenance: `GET /api/maintenance/tickets`, `POST /api/maintenance/tickets`, `PATCH /api/maintenance/tickets/:ticketId/status`
- Maintenance mode: `GET /api/maintenance/modes`, `POST /api/maintenance/modes`, `PATCH /api/maintenance/modes/:modeId/disable`
- Maintenance mode scope: building, zone, or device. Active maintenance mode prevents AI/control writeback from applying to matching devices.
- Edge: `GET /api/edge/health`, `GET /api/edge/command-transport`, `GET /api/energy/forecast`, `POST /api/edge/read-point`, `POST /api/edge/read-points-batch`, `POST /api/edge/write-point`, `POST /api/edge/commands`, `GET /api/bacnet/discovery`
- BACnet MS/TP serial adapter: `POST /api/bacnet/mstp/read`, `POST /api/bacnet/mstp/write`
- Energy Services Interface: `GET /api/energy-services/esi`, `GET /api/energy-services/signals`, `GET /api/energy-services/bws`
- BACnet COV: `POST /api/edge/subscribe-cov`, `POST /api/edge/cov-notifications`
- Edge platform capabilities: `GET /api/edge/capabilities`
- Modbus RTU: `POST /api/modbus/rtu/read`, `POST /api/modbus/rtu/write`
- CAN bus: `POST /api/canbus/send`
- Provisioning: `POST /api/provisioning/discover`, `GET /api/provisioning/status`
- Health: `GET /api/health`, `GET /api/watchdog`
- Event streaming status: `GET /api/events/status`
- Remote management: `GET /api/remote/status`, `POST /api/remote/restart`, `POST /api/remote/update`, `POST /api/remote/watchdog/run`

Remote management endpoints can be protected with `BEMS_MANAGEMENT_TOKEN` and the `X-Management-Token` request header.

Kafka is used for backend event streaming between services and downstream integrations. RabbitMQ AMQP provides topic-exchange routing, durable work-queue delivery, and the default edge/nRF52840 command path. MQTT publishes optional cloud telemetry and alert streams. Published event families include telemetry, live telemetry summaries, alarms, alarm snapshots, analytics, AI control events, AI simulation events, utility demand-response events, field-device commands, and building cost/carbon footprint events. Browser live data still uses Server-Sent Events only; WebSockets are not used.

Application API endpoints can be protected with:

- `BEMS_REQUIRE_AUTH=true`
- `X-Session-Token: <token>` for UI/user sessions created by password login

The default local admin user is `admin` with password `admin`. The password is stored as a salted `scrypt` hash, not plaintext.

## Data Model

The MySQL schema is defined in:

- `database/schema.sql`
- `docker/init/schema.sql`

Main tables:

- `organizations`
- `sites`
- `user_sessions`
- `audit_events`
- `buildings`
- `floors`
- `rooms`
- `zones`
- `devices`
- `roles`
- `users`
- `schedules`
- `holiday_schedules`
- `special_events`
- `alarms`
- `alarm_logs`
- `trend_logs`
- `analytics_events`
- `building_optimization_runs`
- `rl_q_values`
- `optimization_history`
- `fdd_findings`
- `maintenance_tickets`

Reporting uses persisted `trend_logs`, `alarms`, `alarm_logs`, `fdd_findings`, `optimization_history`, and building footprint calculations. The UI Reporting Center exposes report KPIs, a zone-level heat map, PDF/CSV/JSON filtered exports, export audit history, scheduled report delivery configuration, due-run/manual-run execution, notification outbox delivery records, and role-based access through `reports:view`, `reports:export`, and `reports:manage`.
- `maintenance_modes`

Schema migrations are under `node-api/migrations`, and the API container runs them before starting.

The core hierarchy is:

```text
Building
  -> Zone
     -> Floor
        -> Room
     -> Device
        -> BACnet object metadata
```

In operator views and API payloads, `zonePath` is the preferred visible zone label and is derived from `floorName / roomName`. The `zones` table remains the internal control boundary for AI, schedules, alarms, BACnet writeback, and device grouping.

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
- Device persistent storage with medium, namespace, retained keys, wear-leveling metadata, checksum, retained setpoint, and BACnet device-resident schedules for restart-safe control

Setpoint-capable devices can persist their last approved setpoint in EEPROM-style device configuration. Device-scoped schedules are persistent on the BACnet device itself as Schedule objects; the server keeps the audit/configuration copy and mirrors the runnable schedule into `bacnetScheduleStorage` for BACnet WriteProperty synchronization. Controller-class devices can also persist identity, commissioning state, calibration, counters, pulse totals, and range limits in EEPROM, Flash NVS, FRAM, or filesystem-backed storage. The UI exposes storage medium, namespace, EEPROM address, storage size, write policy, wear leveling, retained setpoint storage, and device-resident BACnet schedule storage during provisioning and device configuration. The API stores this metadata in the device `configuration` JSON as `persistentStorage`, `eepromEnabled`, `eepromAddress`, `eepromSizeBytes`, `eepromWritePolicy`, `setpointStorage`, and `bacnetScheduleStorage`.

BACnet bare-metal field devices support OTA update orchestration. `POST /api/firmware/artifacts` creates signed firmware manifests with version, channel, artifact URI, checksum, signature, signing key id, A/B partition scheme, boot slots, and manifest metadata. The server signs with RSA-SHA256 when `OTA_PRIVATE_KEY_PEM` is configured and otherwise uses the development HMAC signer. `POST /api/devices/:deviceId/ota-update` records an OTA job, stores the signed manifest in device configuration, publishes the event-driven update command, and expects the field-device bootloader flow to validate the image, stage it in the inactive A/B slot, swap into `pending-confirmation`, watchdog-confirm the new slot, roll back to the previous confirmed slot on failure, and preserve persistent setpoints and BACnet Schedule objects.

## Deployment Architecture

Docker Compose lives in `docker/docker-compose.yml`.

Services:

- `api`: Ubuntu 22.04 Node.js backend, port `3000`
- `ui`: Ubuntu 22.04 Apache web server serving the production React dashboard, host port `5173` to container port `80`
- `ai-service`: Ubuntu 22.04 Python optimizer, HTTP port `8000`, gRPC port `50052`
- `edge-core`: Ubuntu 22.04 C++ BACnet runtime, BACnet/IP UDP port `47808`, RabbitMQ edge command consumer boundary
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
- RabbitMQ management: `http://localhost:15672` when exposed by deployment profile

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

For demos or test environments without field devices:

```text
BACNET_SIMULATOR_ENABLED=true
```

## Scalability Architecture

The platform is designed to scale from a small building to a distributed enterprise campus without changing the core programming model.

```text
Small Building
  React UI
  Node API + MySQL + AI Service
  One C++ Edge Core
  One BACnet/IP network or simulator

Multi-Building Site
  Shared UI/API
  Shared MySQL tenant/site model
  Edge Core per building or mechanical plant
  BACnet/IP routers for MS/TP trunks
  Modbus/CAN/wireless gateways normalized into devices and points

Large Campus / Enterprise
  Centralized SaaS/admin UI
  Distributed edge appliances
  Site and building isolation through organization/site/building context
  Shared analytics, alarm history, optimization history, and reporting
  Remote management, watchdog health, session auth, RBAC, and audit events
```

Scalability mechanisms:

- Tenant model: organizations, sites, buildings, floors, rooms, zones, and devices
- Override model: global, building, zone, device, holiday, and special-event schedule precedence
- Edge model: one or more C++ edge cores can represent separate BACnet networks or buildings
- Integration model: BACnet/IP, routed BACnet MS/TP, Modbus RTU gateways, CAN gateways, and wireless gateways normalize into the same device model
- Data model: MySQL stores configuration, alarms, schedules, analytics, optimization history, and RL policy state centrally
- UI model: one React GUI can browse building hierarchy, device details, digital twin overlays, alarms, schedules, AI, and maintenance state
- Operations model: watchdog, health checks, remote restart/update intent endpoints, session auth, RBAC, and audit events support managed deployments

## CI

The CI workflow is defined in `.github/workflows/ci.yml`.

It checks:

- C++ CMake configure and build
- C++ writeback safety tests through CTest
- C++ field-device firmware simulator build and unit tests through CTest
- Node API syntax
- Node API auth/RBAC unit tests
- Python AI service syntax
- Python AI optimization/RL unit tests
- UI dependency install
- UI production build

## Enterprise BMS Alignment

This project targets the same operational class as enterprise BMS stacks while keeping the implementation open and modular.

EcoStruxure-style feature mapping:

| This System | EcoStruxure / Enterprise BMS Equivalent | Notes |
| --- | --- | --- |
| React UI | WebStation UI | Browser-based operator graphics, alarms, schedules, device details, dashboards, and admin tools |
| Device tree | System Tree | Building -> floor -> room -> zone -> device hierarchy with BACnet point metadata |
| Floorplan / digital twin | Graphics pages | Equipment graphics, device overlays, live values, status colors, and clickable controls |
| Schedule editor | BACnet Schedule Object | Daily, monthly, yearly, holiday, and special-event scheduling with building/zone/device override precedence; device schedules persist on the BACnet device |
| Alarm workflow | Alarm Server | Active alarms, acknowledge/clear workflow, alarm logs, severity, status, and SSE alarm updates |
| Automation rules | Script / Function Block | Autonomous mode, AI control loop, deterministic decision engine, and ML/rule expansion path |
| Bulk operations | Multi-edit / bindings | Device provisioning, commissioning, schedule inheritance, maintenance mode scoping, and API-driven updates |
| Analytics dashboard | Enterprise analytics | Energy KPIs, optimization history, RL policy state, FDD findings, weather/pricing context, and reports |
| Remote API | Enterprise integration API | HTTP/JSON API, session auth, RBAC, audit events, RabbitMQ edge commands, and AI gRPC service contract |

Implemented alignment:

- Real-building deployment path through Docker services and i.MX93 Yocto packaging
- BACnet/IP discovery and communication path
- BACnet device connection path through C++ UDP/BVLC Who-Is, ReadProperty, and WriteProperty
- Node-to-edge integration over RabbitMQ AMQP commands for discovery, reads, writes, COV subscriptions, and OTA orchestration
- Node-to-AI integration over gRPC through `AiOptimizationService`
- Device provisioning and commissioning
- Alarms and live alarm updates
- Schedules
- Digital twin visualization
- Floorplan editor
- Live telemetry charts
- Live telemetry feed
- Real-time dashboard updates through SSE
- Real-time monitoring panel with telemetry stream state, alarm stream state, latest point updates, and trend logging readiness
- User maintenance UI
- Zone/device browser and device details UI
- Device provisioning UI
- AI control API
- Predictive simulation before writeback
- Weather and pricing optimization context
- Airflow graph model with GNN upgrade path
- Analytics events
- AI optimization engine
- Autonomous AI control loop
- Persistent RL model storage
- Optimization history
- FDD finding persistence
- Maintenance ticketing integration
- Maintenance mode lockout for building, zone, and device service windows
- Autonomous Mode BEMS operator controls
- Watchdog and health checks
- Remote management intent API
- Versioned Node.js Web API
- Login and admin UI
- Session authentication, RBAC, and audit log
- Containerized deployment
- i.MX93 edge packaging path

Not yet implemented as full production subsystems:

- Full BACnet object-list point discovery
- AHU/VAV/zone auto-mapping
- Expanded FDD rule library beyond current status/range/provisioning checks
- VPN/ACL automation
- Fine-grained multi-tenant enterprise RBAC enforcement beyond the current role/user schema
- Field certification, hardening, and site acceptance testing required before controlling occupied production buildings

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
