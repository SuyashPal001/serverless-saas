#!/bin/bash
# Mastra Studio UI — platform admin observability
#
# Runs the Studio browser app on :3010.
# Connects to the Mastra API mounted on the relay at :3001/studio.
#
# Start with PM2:
#   pm2 start apps/relay/scripts/start-studio.sh --name mastra-studio
#
# Or run directly:
#   bash apps/relay/scripts/start-studio.sh

npx mastra studio \
  --port 3010 \
  --server-host localhost \
  --server-port 3001 \
  --server-protocol http \
  --server-api-prefix /studio
