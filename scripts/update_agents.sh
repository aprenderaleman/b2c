#!/usr/bin/env bash
# ----------------------------------------------------------------------
# Update the running agents on the VPS to whatever is at origin/main.
# Run on the VPS as root:
#
#   cd /opt/b2c && bash scripts/update_agents.sh
#
# Steps:
#   1. git pull (deploy key already configured on this host)
#   2. rebuild aa_agents image
#   3. force-recreate scheduler + webhook containers
#   4. tail logs briefly so we see the bootstrap beat
# ----------------------------------------------------------------------

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/b2c}"
cd "$REPO_DIR"

echo "=== git pull ==="
git pull --ff-only origin main

echo
echo "=== docker build ==="
docker build -t aa_agents:latest -f agents/Dockerfile .

echo
echo "=== recreate scheduler ==="
docker stop aa_agents_scheduler 2>/dev/null || true
docker rm   aa_agents_scheduler 2>/dev/null || true
docker run -d \
  --name aa_agents_scheduler \
  --restart unless-stopped \
  --network coolify \
  --env-file "$REPO_DIR/.env" \
  aa_agents:latest python -m agents.scheduler

echo
echo "=== recreate webhook ==="
docker stop aa_agents_webhook 2>/dev/null || true
docker rm   aa_agents_webhook 2>/dev/null || true
docker run -d \
  --name aa_agents_webhook \
  --restart unless-stopped \
  --network coolify \
  --env-file "$REPO_DIR/.env" \
  -p 127.0.0.1:8787:8787 \
  aa_agents:latest python -m agents.webhook

sleep 4
echo
echo "=== scheduler logs (first 10 lines — should show bootstrap heartbeat) ==="
docker logs aa_agents_scheduler --tail=10 2>&1

echo
echo "✓ Update complete. Scheduler + webhook running from commit $(git rev-parse --short HEAD)."
