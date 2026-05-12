#!/bin/bash
# =============================================================================
# vps_auto_deploy.sh
# =============================================================================
# Auto-deploy del repo al VPS cuando hay commits nuevos en origin/main.
#
# Diseñado para correr cada 2 min vía cron. Si no hay cambios → exit 0
# silenciosamente. Si hay cambios:
#   1. Hace git pull (con stash de cambios locales — los archivos SFTP'd
#      en sesiones viejas suelen tener LF/CRLF mismatches que bloquean el pull)
#   2. Detecta si agents/ cambió en algún commit nuevo
#   3. Si sí: rebuild + force-recreate de aa_agents_scheduler y aa_agents_webhook
#   4. Si no (solo web/db): no hace nada (Vercel maneja web)
#
# Idempotente + bloqueo via flock para que dos ticks paralelos no
# choquen. Log en /var/log/auto-deploy.log.
#
# Setup:
#   chmod +x /opt/b2c/scripts/vps_auto_deploy.sh
#   (crontab -l 2>/dev/null; echo "*/2 * * * * /opt/b2c/scripts/vps_auto_deploy.sh >> /var/log/auto-deploy.log 2>&1") | crontab -
# =============================================================================
set -uo pipefail

REPO=/opt/b2c
LOCK=/tmp/vps-auto-deploy.lock
STAMP=/opt/b2c/.last-deploy

cd "$REPO" || { echo "$(date) ✗ cannot cd $REPO"; exit 1; }

# Lock — si otro tick está corriendo, salir
exec 200>"$LOCK"
flock -n 200 || exit 0

# ¿Hay commits nuevos en origin/main?
git fetch origin main --quiet 2>&1 || { echo "$(date) ✗ git fetch failed"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0   # nada que hacer
fi

echo ""
echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
echo "→ Deploy $LOCAL → $REMOTE"

# Stash de archivos modificados locales (SFTP'd anteriores, line-ending
# diffs, etc.) para que el pull no falle. Si stash queda vacío no pasa nada.
git stash push -u -q -m "auto-$(date +%s)" 2>/dev/null || true

# Pull con resolución de fast-forward; si hubiera divergencia real (rebase
# necesario) salimos y dejamos para intervención manual.
if ! git pull --ff-only --quiet origin main; then
    echo "✗ git pull --ff-only falló. Resolver manualmente."
    exit 1
fi

# Detectar qué cambió entre LOCAL y REMOTE
CHANGED_AGENTS=$(git diff --name-only "$LOCAL" "$REMOTE" -- agents/ 2>/dev/null | wc -l)

if [ "$CHANGED_AGENTS" -gt 0 ]; then
    echo "→ $CHANGED_AGENTS file(s) en agents/ — rebuild containers"
    cd "$REPO/whatsapp" || exit 1
    docker compose -f docker-compose.vps.yml build agents_scheduler agents_webhook 2>&1 | tail -3
    docker compose -f docker-compose.vps.yml up -d --force-recreate agents_scheduler agents_webhook 2>&1 | tail -3
    cd "$REPO" || exit 1
    echo "✓ Agents redeployed"
else
    echo "→ Solo web/db/scripts — sin rebuild (Vercel maneja web)"
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$STAMP"
echo "✓ Deploy complete ($REMOTE)"
