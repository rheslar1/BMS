# Dockerized Deployment

This repository supports a Docker Compose deployment including MySQL, Kafka, the Node.js Web API, the Python AI service, the C++ edge core, observability services, and the React frontend served by Apache.

## Start the stack

From `repo/docker`:

```bash
docker compose up --build
```

## Services

- `db`: MySQL 8 database with `bems` initialized from `./init`
- `api`: Ubuntu 22.04 based Node.js Web API exposed on `http://localhost:3000`
- `ui`: Ubuntu 22.04 based Apache web server serving the production React build on `http://localhost:5173`
- `ai-service`: Ubuntu 22.04 based Python AI optimizer exposed on HTTP `http://localhost:8000` and gRPC `localhost:50052`
- `edge-core`: Ubuntu 22.04 based C++ BACnet runtime exposed on gRPC `localhost:50051` and BACnet/IP UDP `47808`
- `kafka`: backend event streaming for telemetry, alarms, analytics, AI control, and footprint events
- `prometheus`: metrics scraping and alert rules
- `grafana`: pre-provisioned BEMS operations dashboard on `http://localhost:3001`
- `alertmanager`: email/Slack alert routing placeholders on `http://localhost:9093`
- `watchtower`: labeled container auto-update support
- `elasticsearch`, `logstash`, `kibana`: optional ELK logging stack under the `observability` profile

The database schema includes SaaS organizations/sites, users, roles, feature flags, audit events, alarms, analytics events, device configuration, schedules, and building optimization run history. The API container runs `npm run migrate` before startup.

## Access

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000/api/health`
- Enterprise API status: `http://localhost:3000/api/v1/status`
- OpenAPI JSON: `http://localhost:3000/api/v1/openapi.json`
- Watchdog: `http://localhost:3000/api/watchdog`
- Digital twin: `http://localhost:3000/api/digital-twin`
- Telemetry SSE stream: `http://localhost:3000/api/telemetry/stream`
- Python AI service health: `http://localhost:8000/health`
- Python AI gRPC: `localhost:50052`
- Kafka external listener: `localhost:9094`
- Kafka/event bus status: `http://localhost:3000/api/events/status`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001` (`admin` / `admin`)
- Alertmanager: `http://localhost:9093`
- Kibana, when observability profile is enabled: `http://localhost:5601`

The API, UI, AI service, and database all define container health checks. The backend watchdog checks MySQL, the optional C++ edge-core connection, and the Python AI service.

## Database

- Username: `root`
- Password: `root`
- Database: `bems`

## Notes

- The UI service uses `VITE_API_URL` to point the browser to the backend API.
- The backend container uses `MYSQL_HOST=db` to connect to the MySQL container by service name.
- `AI_GRPC_ENDPOINT=ai-service:50052` enables Node-to-Python-AI gRPC calls for optimization and reinforcement feedback.
- Set `EDGE_GRPC_ENDPOINT` on the `api` service to enable Node-to-edge-core gRPC calls. If it is unset, the API uses local fallback data for edge health and energy forecast endpoints.
- Set `BEMS_MANAGEMENT_TOKEN` on the `api` service to require `X-Management-Token` for `/api/remote/*` management endpoints.
- Set `BEMS_REQUIRE_AUTH=true` to require `X-Session-Token` session authentication for protected API endpoints.
- The default local UI login is `admin` / `admin`; the database stores a salted `scrypt` password hash.
- User sessions use `X-Session-Token`.
- Role permissions protect admin and mutating routes such as device writes, alarms, schedules, and user management.
- The Admin page can create users, assign user roles, activate/deactivate users, and create permission-based roles.
- Live dashboard updates use Server-Sent Events. WebSockets are not used.
- Backend streaming uses Kafka through `KAFKA_BROKERS=kafka:9092`.
- Start the optional ELK logging stack with `docker compose --profile observability up --build`.
- Alertmanager email and Slack values in `monitoring/alertmanager.yml` are deployment placeholders and should be replaced for production.
- MySQL backups can be created with `../scripts/backup_mysql.sh` and restored with `../scripts/restore_mysql.sh`.
- Canary deployment, promotion, and rollback are scripted in `../scripts/deploy_canary.sh`, `../scripts/promote_canary.sh`, and `../scripts/rollback_canary.sh`.
