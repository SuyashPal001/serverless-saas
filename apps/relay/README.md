# agent-relay

Central relay bridging frontend WebSocket to per-tenant
OpenClaw Docker containers on the GCP VM.

Runs on GCP VM port 3001.
Publicly exposed via NGINX at wss://agent-saas.fitnearn.com

## Local development
cp .env.example .env  # fill in values
npm run dev

## Deploy (GCP VM)
cd /opt/agent-relay && git pull && npm run build && pm2 restart agent-relay
