#!/bin/bash
set -e

echo "→ Building web frontend..."
cd /home/suyashresearchwork/serverless-saas
pnpm --filter @serverless-saas/web build

echo "→ Copying static assets..."
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public

echo "→ Restarting web-frontend..."
pm2 restart web-frontend

echo "✓ Deploy complete"
