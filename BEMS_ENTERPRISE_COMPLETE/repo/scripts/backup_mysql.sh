#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DATABASE="${MYSQL_DATABASE:-bems}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/${DATABASE}-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating MySQL backup: $BACKUP_FILE"
docker compose -f "$COMPOSE_FILE" exec -T db sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events "$MYSQL_DATABASE"' \
  | gzip -9 > "$BACKUP_FILE"

if [[ -n "${S3_BACKUP_URI:-}" ]]; then
  echo "Uploading backup to $S3_BACKUP_URI"
  aws s3 cp "$BACKUP_FILE" "$S3_BACKUP_URI/"
fi

echo "$BACKUP_FILE"
