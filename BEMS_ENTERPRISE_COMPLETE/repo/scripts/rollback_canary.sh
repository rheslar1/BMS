#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ALB_LISTENER_ARN:-}" || -z "${BLUE_TARGET_GROUP_ARN:-}" || -z "${GREEN_TARGET_GROUP_ARN:-}" ]]; then
  echo "ALB_LISTENER_ARN, BLUE_TARGET_GROUP_ARN, and GREEN_TARGET_GROUP_ARN are required." >&2
  exit 2
fi

aws elbv2 modify-listener \
  --listener-arn "$ALB_LISTENER_ARN" \
  --default-actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$BLUE_TARGET_GROUP_ARN,Weight=100},{TargetGroupArn=$GREEN_TARGET_GROUP_ARN,Weight=0}],TargetGroupStickinessConfig={Enabled=false}}"

echo "Canary rolled back to blue."
