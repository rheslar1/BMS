#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Verifying BEMS architecture files..."
./scripts/verify_architecture.sh

echo "Starting BEMS Docker stack..."
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f docker/docker-compose.yml up --build -d
else
  docker compose -f docker/docker-compose.yml up --build -d
fi

echo "BEMS is starting."
echo "UI:  http://localhost:5173"
echo "API: http://localhost:3000/api/v1/status"
