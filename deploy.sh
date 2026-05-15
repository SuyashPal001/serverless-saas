#!/bin/bash
set -e

echo "→ Clearing Next.js cache..."
cd /home/suyashresearchwork/serverless-saas
rm -rf apps/web/.next

echo "→ Building web frontend..."
pnpm --filter @serverless-saas/web build

echo "→ Copying static assets..."
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public

echo "→ Restarting web-frontend..."
pm2 restart web-frontend

echo "✓ Deploy complete"
