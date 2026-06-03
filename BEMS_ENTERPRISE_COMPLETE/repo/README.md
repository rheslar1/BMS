# IntelliBuild Energy

From edge to cloud, smarter buildings.

AI-driven Building Management and Energy Management System for edge deployment.

This repository matches the architecture in `docs/architecture.md`:

- C++ edge core for BACnet/IP discovery, BACnet server/device object database, Modbus RTU/CAN bus adapters, point read/write, control, forecasting, and safe writeback
- Node.js Web API for HTTP/JSON commands, SSE telemetry/alarm streams, authentication, RBAC, SaaS admin, watchdog, FDD, maintenance tickets, AI control, provisioning, and remote management
- Python AI service for whole-building multi-zone optimization and reinforcement-learning support over gRPC
- React/Tailwind operator dashboard with professional light/dark mode, login, admin, user maintenance, charts, alarms, schedules, floorplan editor, digital twin, device provisioning, device details, live telemetry feed, and autonomous mode controls
- MySQL persistence for building hierarchy, devices, schedules, alarms, analytics, users, roles, sessions, audit events, RL Q-values, optimization history, FDD findings, and maintenance tickets
- Docker Compose deployment on Ubuntu containers, including the RabbitMQ-orchestrated C++ edge-core service
- Kafka backend event streaming for telemetry, alarms, analytics, AI control, and building footprint events
- Prometheus, Grafana, Alertmanager, Watchtower, and optional ELK logging for production operations
- CI/CD workflow and scripts for canary deployment, blue/green promotion, rollback, multi-region deployment hooks, and MySQL backup/restore
- Yocto integration path for Digi ConnectCore i.MX93 class devices
- Built-in simulated BACnet devices for local discovery, read/write, provisioning, and dashboard demos without physical HVAC hardware
- BACnet Standard 135-2020 alignment profile in `docs/bacnet-135-2020-conformance.md`
- Production BACnet stack integration path using the SourceForge BACnet Protocol Stack: https://sourceforge.net/projects/bacnet/

The system is designed for the same operating class as commercial BMS/SCADA platforms such as Siemens Desigo CC, Schneider EcoStruxure, and Niagara Framework: real BACnet devices, dashboards, persisted analytics, alarms, embedded deployment, and autonomous energy control.

## Repository Layout

```text
ai-service/        Python AI optimizer with HTTP health/fallback and gRPC optimization
database/          Canonical MySQL schema
docker/            Docker Compose deployment and DB init schema
docs/              Architecture, SDD, SDP, UML, and API surface docs
edge-core/         C++ BACnet/control/energy runtime with RabbitMQ edge orchestration
node-api/          Node.js Web API, auth, RabbitMQ edge client, AI gRPC client, migrations
proto/             gRPC contract for the AI service
scripts/           Local install and architecture verification helpers
ui/                React dashboard
yocto/             i.MX93 Yocto integration layer
.github/           CI workflow
```

## Run Locally

From `repo/docker`:

```bash
docker-compose up --build -d
```

Then open:

- UI: `http://localhost:5173`
- API status: `http://localhost:3000/api/v1/status`
- API health: `http://localhost:3000/api/health`
- Watchdog: `http://localhost:3000/api/watchdog`
- OpenAPI JSON: `http://localhost:3000/api/v1/openapi.json`
- BACnet/IP: UDP `47808`

## Demo Website

Start the local live demo:

```bash
./scripts/start_demo.sh
```

Then open `http://localhost:5173`.

Demo guide: `docs/demo-environment.md`.

Default local login:

- Username: `admin`
- Password: `admin`

The password is stored as a salted `scrypt` hash. UI and API sessions use `X-Session-Token`.

## Real-Time Updates

The project intentionally does not use WebSockets.

- Telemetry stream: `GET /api/telemetry/stream`
- Alarm stream: `GET /api/alarms/stream`

Both streams use Server-Sent Events.

## Simulated BACnet Devices

Docker Compose enables `BACNET_SIMULATOR_ENABLED=true` for the edge core. The simulator provides BACnet instances `101`, `102`, `103`, `201`, `301`, and `302` through the same C++ discovery, ReadProperty, and WriteProperty path used for real BACnet/IP devices.

## AI Control and Digital Twin

The Node.js API exposes a whole-building AI control surface:

- `GET /api/ai/weather-pricing`
- `GET /api/ai/airflow-graph`
- `POST /api/ai/predictive-simulation`
- `POST /api/ai/optimize-operation`
- `GET /api/ai/temperature-trends`
- `GET /api/ai/demand-response`
- `POST /api/ai/control/iterate`
- `POST /api/ai/control/start`
- `POST /api/ai/control/stop`

The control loop collects zone/device state, builds a global building state, requests optimal actions, simulates the result, optionally applies safe setpoint changes, measures reward, and persists RL feedback/history.

## Product Documentation

- Product overview, installable system model, publish-ready architecture diagram, and pricing strategy: `docs/product-overview.md`
- Deployment and Docker operations: `docker/README.md`
- Full technical architecture: `docs/architecture.md`

## Verify Architecture Alignment

Run:

```bash
./scripts/verify_architecture.sh
```

The script checks required project files, core API/protocol markers, auth/RBAC markers, migration files, SSE usage, and the no-WebSocket rule.

## Build Checks

Useful local checks:

```bash
node --check node-api/server.js
node --check node-api/auth.js
node --check node-api/aiClient.js
node --check node-api/edgeClient.js
npm --prefix node-api test
python3 -m py_compile ai-service/app.py
(cd ai-service && python3 -m unittest test_app.py)
cmake -S edge-core -B /tmp/bems-edge-build
cmake --build /tmp/bems-edge-build
ctest --test-dir /tmp/bems-edge-build --output-on-failure
npm --prefix ui run build
```

## Environment

Use `.env.example` as the deployment reference for Docker, API, AI service, RabbitMQ edge orchestration, auth, and BACnet binding settings.
