#!/usr/bin/env bash
set -euo pipefail

CANARY_PERCENT="${CANARY_PERCENT:-100}"

if [[ -z "${ALB_LISTENER_ARN:-}" || -z "${BLUE_TARGET_GROUP_ARN:-}" || -z "${GREEN_TARGET_GROUP_ARN:-}" ]]; then
  echo "ALB_LISTENER_ARN, BLUE_TARGET_GROUP_ARN, and GREEN_TARGET_GROUP_ARN are required." >&2
  exit 2
fi

BLUE_WEIGHT=$((100 - CANARY_PERCENT))
aws elbv2 modify-listener \
  --listener-arn "$ALB_LISTENER_ARN" \
  --default-actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$BLUE_TARGET_GROUP_ARN,Weight=$BLUE_WEIGHT},{TargetGroupArn=$GREEN_TARGET_GROUP_ARN,Weight=$CANARY_PERCENT}],TargetGroupStickinessConfig={Enabled=false}}"

echo "Canary promoted to ${CANARY_PERCENT}%."
