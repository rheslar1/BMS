#!/usr/bin/env bash
set -euo pipefail

REGION="${REGION:-primary}"
REMOTE_HOST="${REMOTE_HOST:?REMOTE_HOST is required}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/bems}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
CANARY_PERCENT="${CANARY_PERCENT:-10}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"

echo "Deploying BEMS canary to $REGION on $SSH_TARGET with tag $IMAGE_TAG at ${CANARY_PERCENT}%"

ssh -o StrictHostKeyChecking=no "$SSH_TARGET" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_APP_DIR/repo/docker"
export IMAGE_TAG="$IMAGE_TAG"
export BEMS_API_IMAGE="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-bems}/bems-api:$IMAGE_TAG"
export BEMS_UI_IMAGE="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-bems}/bems-ui:$IMAGE_TAG"
export BEMS_AI_IMAGE="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-bems}/bems-ai-service:$IMAGE_TAG"
export BEMS_EDGE_IMAGE="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-bems}/bems-edge-core:$IMAGE_TAG"
export BEMS_DEPLOY_SLOT="green"
docker compose -p bems-green pull || true
docker compose -p bems-green up -d --build
for attempt in \$(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "Canary green slot healthy."
    exit 0
  fi
  sleep 5
done
echo "Canary green slot failed health check." >&2
docker compose -p bems-green logs --tail=120
exit 1
REMOTE

if [[ -n "${ALB_LISTENER_ARN:-}" && -n "${BLUE_TARGET_GROUP_ARN:-}" && -n "${GREEN_TARGET_GROUP_ARN:-}" ]]; then
  BLUE_WEIGHT=$((100 - CANARY_PERCENT))
  echo "Updating ALB listener weights: blue=$BLUE_WEIGHT green=$CANARY_PERCENT"
  aws elbv2 modify-listener \
    --listener-arn "$ALB_LISTENER_ARN" \
    --default-actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$BLUE_TARGET_GROUP_ARN,Weight=$BLUE_WEIGHT},{TargetGroupArn=$GREEN_TARGET_GROUP_ARN,Weight=$CANARY_PERCENT}],TargetGroupStickinessConfig={Enabled=false}}"
else
  echo "ALB variables not set; green slot is healthy but traffic weights were not changed."
fi
