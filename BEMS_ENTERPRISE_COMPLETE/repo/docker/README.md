# Dockerized Deployment

This repository supports a Docker Compose deployment including MySQL, the Node.js backend, and the React frontend.

## Start the stack

From `repo/docker`:

```bash
docker compose up --build
```

## Services

- `db`: MySQL 8 database with `bems` initialized from `./init`
- `api`: Ubuntu 24.04 based Node.js backend exposed on `http://localhost:3000`
- `ui`: Ubuntu 24.04 based React/Vite frontend exposed on `http://localhost:5173`
- `ai-service`: Ubuntu 24.04 based Python AI optimizer exposed on HTTP `http://localhost:8000` and gRPC `localhost:50052`

The database schema includes alarms, analytics events, device configuration, schedules, and building optimization run history.

## Access

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000/api/health`
- Watchdog: `http://localhost:3000/api/watchdog`
- Digital twin: `http://localhost:3000/api/digital-twin`
- Telemetry SSE stream: `http://localhost:3000/api/telemetry/stream`
- Python AI service health: `http://localhost:8000/health`
- Python AI gRPC: `localhost:50052`

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
