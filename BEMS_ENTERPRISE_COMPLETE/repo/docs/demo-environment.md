# IntelliBuild Energy Demo Environment

**From edge to cloud, smarter buildings.**

## Live Website

The local demo website runs at:

```text
http://localhost:5173
```

Default demo login:

```text
Username: admin
Password: admin
```

## Start The Demo

From the repository root:

```bash
./scripts/start_demo.sh
```

The script verifies architecture markers, starts the Docker Compose demo services, waits for the API and UI to become healthy, and prints the demo URLs.

## Demo Services

| Service | URL / Port | Purpose |
| --- | --- | --- |
| React website | `http://localhost:5173` | IntelliBuild Energy operator UI |
| Node API | `http://localhost:3000/api/v1/status` | REST API, SSE, auth, SaaS, orchestration |
| API health | `http://localhost:3000/api/health` | Watchdog-facing health endpoint |
| Digital twin | `http://localhost:3000/api/digital-twin` | Building/device mirror |
| Telemetry stream | `http://localhost:3000/api/telemetry/stream` | Server-Sent Events live telemetry |
| AI service | `http://localhost:8000/health` | Python optimizer health |
| Edge gRPC | `localhost:50051` | C++ EdgeCoreService |
| AI gRPC | `localhost:50052` | Python AI gRPC |
| BACnet/IP | UDP `47808` | Edge BACnet/IP port |

## What The Demo Shows

- Home Page dashboard with KPIs, live cards, charts, alarms, schedules, and AI status.
- Building/floor/room/zone/device hierarchy.
- Simulated BACnet devices for discovery, ReadProperty, WriteProperty, and SubscribeCOV.
- Drag-and-drop floorplan editor.
- AHU/VAV graphics.
- Alarm console and alarm logs.
- Trend charts and live telemetry feed.
- Multi-tenant admin, users, roles, and feature flags.
- AI optimization, reinforcement learning policy, predictive simulation, demand response, and energy/carbon footprint panels.

## Demo Field Data

Docker Compose enables the built-in BACnet simulator through:

```text
BACNET_SIMULATOR_ENABLED=true
```

The simulator exposes example device instances such as:

| Instance | Device |
| --- | --- |
| `101` | Lobby temperature |
| `102` | Floor 1 VAV damper |
| `103` | Floor 2 temperature |
| `201` | Floor 1 supply fan |
| `250` | Occupancy schedule |
| `301` | Tower B lobby light |
| `302` | Tower B damper |

## Live Update Policy

Browser live updates use **Server-Sent Events**:

- `/api/telemetry/stream`
- `/api/alarms/stream`

The demo does not use WebSockets.

## Optional Observability Demo

To include Prometheus, Grafana, Alertmanager, Kafka, Watchtower, and optional ELK services:

```bash
cd docker
docker compose --profile observability up --build -d
```

Useful URLs:

```text
Grafana:      http://localhost:3001
Prometheus:  http://localhost:9090
Alertmanager:http://localhost:9093
Kibana:      http://localhost:5601
```

Grafana demo login:

```text
admin / admin
```

## Stop The Demo

```bash
cd docker
docker compose down
```

If your machine uses legacy Compose:

```bash
docker-compose down
```
