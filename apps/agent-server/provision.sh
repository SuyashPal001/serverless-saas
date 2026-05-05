#!/usr/bin/env bash
# Usage: provision.sh <tenantId> <serviceKey> <gatewayToken> <bridgePort> [agentSlug]
# agentSlug is the agent UUID (immutable) — never derived from agent name.
# All args are positional. agent-server resolves agentSlug and assigns bridgePort before calling this.
set -euo pipefail

TENANT_ID="${1:?Usage: provision.sh <tenantId> <serviceKey> <gatewayToken> <bridgePort> [agentSlug]}"
SERVICE_KEY="${2:?Missing serviceKey}"
GATEWAY_TOKEN="${3:?Missing gatewayToken}"
BRIDGE_PORT="${4:?Missing bridgePort}"
AGENT_SLUG="${5:-default}"
TOOLS_JSON="${6:-[\"retrieve_documents\"]}"
RELAY_DEVICE_ID="${RELAY_DEVICE_ID:?Missing RELAY_DEVICE_ID env var}"
RELAY_PUBLIC_KEY="${RELAY_PUBLIC_KEY:?Missing RELAY_PUBLIC_KEY env var}"
RELAY_SERVICE_KEY="${RELAY_SERVICE_KEY:?Missing RELAY_SERVICE_KEY env var — set to relay INTERNAL_SERVICE_KEY}"

# Validate inputs — these values land in container names and paths
if [[ ! "$TENANT_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "[provision] ERROR: tenantId must be alphanumeric/hyphens/underscores" >&2
  exit 1
fi
if [[ ! "$AGENT_SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "[provision] ERROR: agentSlug must be lowercase alphanumeric/hyphens" >&2
  exit 1
fi
if [[ ! "$BRIDGE_PORT" =~ ^[0-9]+$ ]]; then
  echo "[provision] ERROR: bridgePort must be numeric" >&2
  exit 1
fi

CONTAINER_NAME="openclaw-${TENANT_ID}-${AGENT_SLUG}"
VOLUME_DIR="/opt/tenants/${TENANT_ID}/${AGENT_SLUG}"
CONFIG_FILENAME="openclaw-${TENANT_ID}-${AGENT_SLUG}.json"
CONFIG_PATH="${VOLUME_DIR}/${CONFIG_FILENAME}"
TEMPLATE_PATH="/opt/agent-server/templates/openclaw-template.json"
EXTENSIONS_DIR="${EXTENSIONS_DIR:-/opt/openclaw-extensions/saas}"
IMAGE="openclaw-saas:latest"

echo "[provision] Provisioning ${CONTAINER_NAME} on bridge port ${BRIDGE_PORT}..."

# Ensure Docker network exists
docker network create openclaw-network --driver bridge 2>/dev/null || true

# Create per-tenant volume and workspace directories
mkdir -p "${VOLUME_DIR}"
mkdir -p "${VOLUME_DIR}/workspace"

# Remove bootstrap script so the agent starts with its pre-configured identity
rm -f "${VOLUME_DIR}/workspace/BOOTSTRAP.md"

# Seed SOUL.md from template so the container never uses the image default
cp /opt/agent-server/templates/SOUL.md "${VOLUME_DIR}/workspace/SOUL.md"
echo "[provision] Seeded SOUL.md from template"
cp /opt/agent-server/templates/IDENTITY.md "${VOLUME_DIR}/workspace/IDENTITY.md"
echo "[provision] Seeded IDENTITY.md from template"

# Pre-write devices/paired.json so the relay is already paired on first boot.
# The relay's deviceId and publicKey are static (derived from DEVICE_IDENTITY in agent-relay).
mkdir -p "${VOLUME_DIR}/devices"
NOW_MS=$(date +%s%3N)
cat > "${VOLUME_DIR}/devices/paired.json" << PAIRED_JSON
{
  "${RELAY_DEVICE_ID}": {
    "requestId": "00000000-0000-0000-0000-000000000000",
    "deviceId": "${RELAY_DEVICE_ID}",
    "publicKey": "${RELAY_PUBLIC_KEY}",
    "platform": "linux",
    "clientId": "gateway-client",
    "clientMode": "backend",
    "role": "operator",
    "roles": ["operator"],
    "scopes": ["operator.read", "operator.write", "operator.admin"],
    "remoteIp": "172.21.0.1",
    "silent": false,
    "isRepair": false,
    "ts": ${NOW_MS},
    "tokens": {
      "operator": {
        "token": "${GATEWAY_TOKEN}",
        "role": "operator",
        "scopes": ["operator.admin", "operator.read", "operator.write"],
        "createdAtMs": ${NOW_MS}
      }
    }
  }
}
PAIRED_JSON
echo "[provision] Pre-wrote devices/paired.json for relay device"

# Template the openclaw config for this tenant/agent
sed \
  -e "s|__TENANT_ID__|${TENANT_ID}|g" \
  -e "s|__SERVICE_KEY__|${SERVICE_KEY}|g" \
  -e "s|__RELAY_SERVICE_KEY__|${RELAY_SERVICE_KEY}|g" \
  -e "s|__GATEWAY_TOKEN__|${GATEWAY_TOKEN}|g" \
  -e "s|__TOOLS__|${TOOLS_JSON}|g" \
  "${TEMPLATE_PATH}" > "${CONFIG_PATH}"

echo "[provision] Config written to ${CONFIG_PATH}"

# Clear stale session files so the container always boots with a clean conversation state
SESSION_DIR="${VOLUME_DIR}/agents"
if [ -d "${SESSION_DIR}" ]; then
  SESSION_COUNT=$(find "${SESSION_DIR}" -name "*.jsonl" 2>/dev/null | wc -l)
  if [ "${SESSION_COUNT}" -gt 0 ]; then
    find "${SESSION_DIR}" -name "*.jsonl" -delete
    echo "[provision] Cleared ${SESSION_COUNT} stale session file(s)"
  fi
fi

# Stop and remove any existing container with this name
if docker inspect "${CONTAINER_NAME}" &>/dev/null; then
  echo "[provision] Removing existing container ${CONTAINER_NAME}..."
  docker stop --time 2 "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}"
fi

# Start the container
# Port 18789 = openclaw gateway (HTTP + WS) — published to host as BRIDGE_PORT
docker run -d \
  --name "${CONTAINER_NAME}" \
  --network openclaw-network \
  --add-host=host.docker.internal:host-gateway \
  --restart unless-stopped \
  --memory 1g \
  --memory-swap 1g \
  --cpus 0.5 \
  --pids-limit 200 \
  -p "${BRIDGE_PORT}:18789" \
  -v "${VOLUME_DIR}:/home/node/.openclaw" \
  -v "${EXTENSIONS_DIR}:/home/node/.openclaw/extensions/saas:ro" \
  -e "HOME=/home/node" \
  -e "TERM=xterm-256color" \
  -e "OPENCLAW_CONFIG_PATH=/home/node/.openclaw/${CONFIG_FILENAME}" \
  -e "OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}" \
  -e "MCP_URL=http://host.docker.internal:3002/mcp" \
  -e "RAG_URL=http://host.docker.internal:3001/rag/retrieve" \
  --health-cmd 'node -e "fetch(\"http://127.0.0.1:18789/healthz\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"' \
  --health-interval 5s \
  --health-timeout 5s \
  --health-retries 3 \
  --health-start-period 80s \
  "${IMAGE}" \
  node dist/index.js gateway --bind lan --port 18789

echo "[provision] Container ${CONTAINER_NAME} started — waiting for readiness..."

# Block until the gateway HTTP health endpoint responds, then allow plugin load time.
# This ensures provision.sh only exits (and agent-server only returns 200) once
# the container is truly ready to accept WebSocket connections — eliminating the
# race condition where the relay routes traffic to a container still starting up.
# Observed startup: ~76-80s from docker run to HTTP health passing; up to ~160s on first provision.
HEALTH_URL="http://localhost:${BRIDGE_PORT}/health"
ELAPSED=0
TIMEOUT=180
while [ "${ELAPSED}" -lt "${TIMEOUT}" ]; do
  HTTP_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 2 "${HEALTH_URL}" 2>/dev/null || true)
  if [ "${HTTP_STATUS}" = "200" ]; then
    echo "[provision] Gateway healthy at ${ELAPSED}s — waiting 3s for plugin load..."
    sleep 3
    echo "[provision] ${CONTAINER_NAME} ready on port ${BRIDGE_PORT}"
    echo "${CONTAINER_NAME}:${BRIDGE_PORT}"
    exit 0
  fi
  sleep 2
  ELAPSED=$(( ELAPSED + 2 ))
done

echo "[provision] ERROR: ${CONTAINER_NAME} did not become healthy within ${TIMEOUT}s" >&2
exit 1
