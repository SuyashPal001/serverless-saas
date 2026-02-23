#!/bin/bash
set -e

PORT=${1:-3000}

echo "🔍 Forcefully cleaning port $PORT..."

# Kill ALL SAM local processes first
pkill -f "sam local" 2>/dev/null || true
sleep 1

# Then kill anything on the port (multiple attempts)
for i in {1..3}; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -z "$PID" ]; then
    break
  fi
  echo "⚠️  Attempt $i: Killing PID $PID on port $PORT..."
  kill -9 $PID 2>/dev/null || true
  sleep 1
done

# Final verification
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "❌ ERROR: Could not free port $PORT"
  echo "💡 Manually run: kill -9 \$(lsof -ti:$PORT)"
  exit 1
fi

echo "✅ Port $PORT is free!"
echo "🚀 Starting SAM local API on port $PORT..."
sam local start-api --env-vars env.json --port $PORT
