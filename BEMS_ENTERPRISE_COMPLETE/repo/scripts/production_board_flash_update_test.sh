#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-preflight}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BOARD_HOST="${BOARD_HOST:-}"
BOARD_USER="${BOARD_USER:-root}"
BOARD_SSH_OPTS="${BOARD_SSH_OPTS:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
SESSION_TOKEN="${SESSION_TOKEN:-}"
IMAGE_WIC_GZ="${IMAGE_WIC_GZ:-}"
FLASH_TARGET_DEVICE="${FLASH_TARGET_DEVICE:-}"
FLASH_CONFIRM="${FLASH_CONFIRM:-}"
SWU_IMAGE="${SWU_IMAGE:-}"
SWU_URL="${SWU_URL:-}"
SWU_SHA256="${SWU_SHA256:-}"
DEVICE_ID="${DEVICE_ID:-}"
ARTIFACT_ID="${ARTIFACT_ID:-}"
SYSTEM_PACKAGES="${SYSTEM_PACKAGES:-}"
PACKAGE_MANAGER="${PACKAGE_MANAGER:-auto}"
BACNET_DEVICE_INSTANCE="${BACNET_DEVICE_INSTANCE:-1001}"
BACNET_OBJECT_TYPE="${BACNET_OBJECT_TYPE:-analogInput}"
BACNET_OBJECT_INSTANCE="${BACNET_OBJECT_INSTANCE:-1}"
NRF52840_DEVICE_ID="${NRF52840_DEVICE_ID:-}"
PROTOCOL="${PROTOCOL:-knx-ip}"
HARDENING_PROFILE="${HARDENING_PROFILE:-site-acceptance-7d}"
MSTP_MAC_ADDRESS="${MSTP_MAC_ADDRESS:-5}"
MODBUS_SLAVE_ADDRESS="${MODBUS_SLAVE_ADDRESS:-1}"
MODBUS_REGISTER_ADDRESS="${MODBUS_REGISTER_ADDRESS:-0}"
SITE_NAME="${SITE_NAME:-lab-site}"

log() {
  printf '[production-board-test] %s\n' "$*"
}

fail() {
  printf '[production-board-test] ERROR: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

ssh_board() {
  [[ -n "$BOARD_HOST" ]] || fail "BOARD_HOST is required for board SSH actions."
  # shellcheck disable=SC2086
  ssh $BOARD_SSH_OPTS "${BOARD_USER}@${BOARD_HOST}" "$@"
}

curl_api() {
  local args=()
  if [[ -n "$SESSION_TOKEN" ]]; then
    args+=("-H" "X-Session-Token: ${SESSION_TOKEN}")
  fi
  curl -fsS "${args[@]}" "$@"
}

preflight() {
  need_command curl
  need_command sha256sum
  need_command ssh
  [[ -f "$ROOT_DIR/yocto/meta-bems/recipes-bems/images/bems-edge-core-image.bb" ]] || fail "Yocto image recipe is missing."
  [[ -f "$ROOT_DIR/edge-core/scripts/bems-swupdate-client.sh" ]] || fail "SWUpdate client wrapper is missing."
  [[ -f "$ROOT_DIR/edge-core/scripts/bems-system-package-update.sh" ]] || fail "System package update script is missing."
  log "Local production flashing/update preflight passed."
}

flash_media() {
  preflight
  need_command sudo
  [[ -n "$IMAGE_WIC_GZ" ]] || fail "IMAGE_WIC_GZ is required."
  [[ -f "$IMAGE_WIC_GZ" ]] || fail "IMAGE_WIC_GZ does not exist: $IMAGE_WIC_GZ"
  [[ -n "$FLASH_TARGET_DEVICE" ]] || fail "FLASH_TARGET_DEVICE is required, for example /dev/sdX."
  [[ "$FLASH_CONFIRM" == "YES_FLASH_TARGET" ]] || fail "Set FLASH_CONFIRM=YES_FLASH_TARGET to write $IMAGE_WIC_GZ to $FLASH_TARGET_DEVICE."
  [[ -b "$FLASH_TARGET_DEVICE" ]] || fail "FLASH_TARGET_DEVICE is not a block device: $FLASH_TARGET_DEVICE"

  log "Writing $IMAGE_WIC_GZ to $FLASH_TARGET_DEVICE."
  gzip -dc "$IMAGE_WIC_GZ" | sudo dd of="$FLASH_TARGET_DEVICE" bs=4M conv=fsync status=progress
  sync
  log "Flash write complete. Power-cycle or boot the target board from $FLASH_TARGET_DEVICE."
}

validate_boot() {
  preflight
  log "Checking board boot and installed services on ${BOARD_USER}@${BOARD_HOST}."
  ssh_board "uname -a"
  ssh_board "systemctl is-enabled bems-edge-core.service && systemctl is-active bems-edge-core.service"
  ssh_board "command -v swupdate && swupdate --version | head -20"
  ssh_board "test -x /usr/bin/bems-swupdate-client"
  ssh_board "test -x /usr/lib/swupdate/bems-system-package-update.sh"
  ssh_board "journalctl -u bems-edge-core.service --no-pager -n 40"
  log "Boot validation passed."
}

hardware_inventory() {
  preflight
  log "Collecting physical hardware inventory from ${BOARD_USER}@${BOARD_HOST}."
  ssh_board "printf 'hostname=' && hostname"
  ssh_board "printf 'kernel=' && uname -a"
  ssh_board "printf 'cpu=' && (grep -m1 'model name\\|Hardware' /proc/cpuinfo || true)"
  ssh_board "printf 'memory=' && free -h | sed -n '2p'"
  ssh_board "printf 'storage=' && lsblk -o NAME,SIZE,TYPE,MOUNTPOINT"
  ssh_board "printf 'network=' && ip -brief address"
  ssh_board "printf 'serial=' && ls /dev/ttyS* /dev/ttyUSB* /dev/ttyAMA* 2>/dev/null || true"
  ssh_board "printf 'bootloader=' && (fw_printenv bootcount 2>/dev/null || true)"
  log "Hardware inventory collected."
}

ota_install() {
  validate_boot
  local source="${SWU_URL:-$SWU_IMAGE}"
  [[ -n "$source" ]] || fail "SWU_URL or SWU_IMAGE is required."
  if [[ -n "$SWU_IMAGE" && -f "$SWU_IMAGE" && -z "$SWU_URL" ]]; then
    need_command scp
    log "Copying $SWU_IMAGE to board."
    # shellcheck disable=SC2086
    scp $BOARD_SSH_OPTS "$SWU_IMAGE" "${BOARD_USER}@${BOARD_HOST}:/tmp/$(basename "$SWU_IMAGE")"
    source="/tmp/$(basename "$SWU_IMAGE")"
  fi
  log "Running SWUpdate client on board with source: $source."
  ssh_board "SWUPDATE_EXPECTED_SHA256='${SWU_SHA256}' /usr/bin/bems-swupdate-client '$source'"
  log "SWUpdate install command completed. Reboot the board if the bootloader policy requires it, then run validate-boot."
}

package_update() {
  validate_boot
  [[ -n "$SYSTEM_PACKAGES" ]] || fail "SYSTEM_PACKAGES is required."
  log "Applying explicit system package update on board: $SYSTEM_PACKAGES."
  ssh_board "SWUPDATE_SYSTEM_PACKAGES='${SYSTEM_PACKAGES}' SWUPDATE_PACKAGE_MANAGER='${PACKAGE_MANAGER}' /usr/lib/swupdate/bems-system-package-update.sh"
  log "System package update completed."
}

rabbitmq_ota_command() {
  preflight
  [[ -n "$DEVICE_ID" ]] || fail "DEVICE_ID is required."
  [[ -n "$ARTIFACT_ID" ]] || fail "ARTIFACT_ID is required."
  log "Queueing RabbitMQ SWUpdate OTA command through Node API."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"artifactId\":${ARTIFACT_ID},\"rollbackAllowed\":true}" \
    "${API_BASE_URL}/api/devices/${DEVICE_ID}/ota-update"
  printf '\n'
  log "OTA command queued. Confirm the board consumes swupdate.install and updates OTA job status."
}

bacnet_smoke() {
  preflight
  log "Running BACnet ReadPropertyMultiple smoke check through Node API."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"points\":[{\"deviceInstance\":${BACNET_DEVICE_INSTANCE},\"objectType\":\"${BACNET_OBJECT_TYPE}\",\"objectInstance\":${BACNET_OBJECT_INSTANCE},\"property\":\"present-value\"}]}" \
    "${API_BASE_URL}/api/edge/read-points-batch"
  printf '\n'
  log "Running COV subscription smoke check through Node API."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"deviceInstance\":${BACNET_DEVICE_INSTANCE},\"objectType\":\"${BACNET_OBJECT_TYPE}\",\"objectInstance\":${BACNET_OBJECT_INSTANCE},\"property\":\"present-value\"}" \
    "${API_BASE_URL}/api/edge/subscribe-cov"
  printf '\n'
}

nrf52840_smoke() {
  preflight
  [[ -n "$NRF52840_DEVICE_ID" ]] || fail "NRF52840_DEVICE_ID is required."
  log "Checking nRF52840 BACnet device metadata through hierarchy API."
  curl_api "${API_BASE_URL}/api/hierarchy" \
    | grep -E "\"deviceId\":${NRF52840_DEVICE_ID}|\"chipset\":\"nRF52840\"|\"batteryPercent\"" >/dev/null
  log "nRF52840 metadata smoke check passed."
}

serial_adapter_smoke() {
  preflight
  log "Running BACnet MS/TP and Modbus RTU serial adapter smoke checks."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"macAddress\":${MSTP_MAC_ADDRESS},\"deviceInstance\":${BACNET_DEVICE_INSTANCE},\"objectType\":\"${BACNET_OBJECT_TYPE}\",\"objectInstance\":${BACNET_OBJECT_INSTANCE}}" \
    "${API_BASE_URL}/api/bacnet/mstp/read"
  printf '\n'
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"slaveAddress\":${MODBUS_SLAVE_ADDRESS},\"registerAddress\":${MODBUS_REGISTER_ADDRESS},\"quantity\":1}" \
    "${API_BASE_URL}/api/modbus/rtu/read"
  printf '\n'
}

commissioning_readiness() {
  preflight
  log "Checking commissioning readiness workflow."
  curl_api "${API_BASE_URL}/api/commissioning/readiness" | grep -E "\"workflow\":\"richer commissioning tools\"|\"readyForAcceptance\"" >/dev/null
  log "Commissioning readiness workflow responded."
}

protocol_smoke() {
  preflight
  log "Running broader protocol smoke test for $PROTOCOL."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"protocol\":\"${PROTOCOL}\",\"target\":{\"objectType\":\"analogValue\",\"objectInstance\":1}}" \
    "${API_BASE_URL}/api/protocols/smoke-test"
  printf '\n'
}

hardening_soak() {
  preflight
  log "Planning long-run field hardening soak profile $HARDENING_PROFILE."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"profile\":\"${HARDENING_PROFILE}\"}" \
    "${API_BASE_URL}/api/field-hardening/soak-test"
  printf '\n'
}

commercial_readiness() {
  preflight
  log "Creating commercial readiness evidence plan for $SITE_NAME."
  curl_api \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"site\":\"${SITE_NAME}\",\"includeCybersecurityReview\":true,\"includeVendorGatewayTesting\":true,\"includeOperatorWorkflow\":true,\"includeEngineeringWorkflow\":true}" \
    "${API_BASE_URL}/api/commercial-readiness/review"
  printf '\n'
}

case "$ACTION" in
  preflight) preflight ;;
  flash-media) flash_media ;;
  hardware-inventory) hardware_inventory ;;
  validate-boot) validate_boot ;;
  ota-install) ota_install ;;
  package-update) package_update ;;
  rabbitmq-ota-command) rabbitmq_ota_command ;;
  bacnet-smoke) bacnet_smoke ;;
  nrf52840-smoke) nrf52840_smoke ;;
  serial-adapter-smoke) serial_adapter_smoke ;;
  commissioning-readiness) commissioning_readiness ;;
  protocol-smoke) protocol_smoke ;;
  hardening-soak) hardening_soak ;;
  commercial-readiness) commercial_readiness ;;
  full-cycle)
    hardware_inventory
    validate_boot
    ota_install
    package_update
    rabbitmq_ota_command
    bacnet_smoke
    serial_adapter_smoke
    nrf52840_smoke
    commissioning_readiness
    protocol_smoke
    hardening_soak
    commercial_readiness
    ;;
  *)
    cat >&2 <<USAGE
Usage: $0 <action>

Actions:
  preflight
  flash-media
  hardware-inventory
  validate-boot
  ota-install
  package-update
  rabbitmq-ota-command
  bacnet-smoke
  serial-adapter-smoke
  nrf52840-smoke
  commissioning-readiness
  protocol-smoke
  hardening-soak
  commercial-readiness
  full-cycle

Required environment depends on action:
  IMAGE_WIC_GZ, FLASH_TARGET_DEVICE, FLASH_CONFIRM=YES_FLASH_TARGET
  BOARD_HOST, BOARD_USER, SWU_IMAGE or SWU_URL, SWU_SHA256
  API_BASE_URL, SESSION_TOKEN, DEVICE_ID, ARTIFACT_ID
  SYSTEM_PACKAGES, PACKAGE_MANAGER
  PROTOCOL, HARDENING_PROFILE
  MSTP_MAC_ADDRESS, MODBUS_SLAVE_ADDRESS, MODBUS_REGISTER_ADDRESS
  SITE_NAME
USAGE
    exit 64
    ;;
esac
