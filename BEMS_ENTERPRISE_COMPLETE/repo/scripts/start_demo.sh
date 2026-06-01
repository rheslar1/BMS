#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Verifying IntelliBuild Energy architecture..."
./scripts/verify_architecture.sh

echo "Starting IntelliBuild Energy demo stack..."
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f docker/docker-compose.yml)
else
  COMPOSE=(docker compose -f docker/docker-compose.yml)
fi

"${COMPOSE[@]}" up --build -d db ai-service edge-core api ui

echo "Waiting for demo endpoints..."
for attempt in $(seq 1 60); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 &&
     curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [ "$attempt" -eq 60 ]; then
    echo "Demo did not become healthy in time." >&2
    "${COMPOSE[@]}" ps >&2 || true
    exit 1
  fi
done

echo
echo "IntelliBuild Energy demo is live."
echo "Website:       http://localhost:5173"
echo "API status:    http://localhost:3000/api/v1/status"
echo "Health:        http://localhost:3000/api/health"
echo "Digital twin:  http://localhost:3000/api/digital-twin"
echo "Telemetry SSE: http://localhost:3000/api/telemetry/stream"
echo
echo "Demo login: admin / admin"
