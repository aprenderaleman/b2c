#!/usr/bin/env bash
# ------------------------------------------------------------
# Aprender-Aleman.de — Hetzner VPS one-shot install.
#
# On your VPS (Ubuntu 22.04 / 24.04):
#   ssh root@<vps-ip>
#   # (first time) upload the b2c/ repo:
#   #   scp -r b2c root@<vps-ip>:/opt/
#   cd /opt/b2c
#   sudo bash scripts/deploy_vps.sh
#
# After it finishes, run ONCE to link WhatsApp by QR:
#   sudo -u aa python3 agents/scripts/bootstrap_whatsapp.py
# ------------------------------------------------------------
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

REPO_DIR="${REPO_DIR:-/opt/b2c}"
SERVICE_USER="${SERVICE_USER:-aa}"
DOMAIN_EVOLUTION="${DOMAIN_EVOLUTION:?Set DOMAIN_EVOLUTION=evolution.yourdomain.de}"
DOMAIN_AGENTS="${DOMAIN_AGENTS:?Set DOMAIN_AGENTS=agents.yourdomain.de}"

echo "=== Deploying Aprender-Aleman.de B2C system to this VPS ==="
echo "Repo dir:      $REPO_DIR"
echo "Service user:  $SERVICE_USER"
echo "Evolution URL: https://$DOMAIN_EVOLUTION"
echo "Agents URL:    https://$DOMAIN_AGENTS"
echo

# ── 1. System prerequisites ───────────────────────────────
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates git python3 python3-pip python3-venv \
  ufw fail2ban

# Docker
if ! command -v docker >/dev/null; then
  echo "→ Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

# Firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
yes | ufw enable || true

# ── 2. Service user ───────────────────────────────────────
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$SERVICE_USER"
  usermod -aG docker "$SERVICE_USER"
fi

# ── 3. Repo permissions ───────────────────────────────────
chown -R "$SERVICE_USER":"$SERVICE_USER" "$REPO_DIR"

# ── 4. .env bootstrap ─────────────────────────────────────
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
fi
if [ ! -f "$REPO_DIR/whatsapp/.env" ]; then
  API_KEY="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
  DB_PASS="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
  sed "s|change-me-to-a-long-random-string|$API_KEY|; s|change-me-too|$DB_PASS|; \
       s|http://localhost:8080|https://$DOMAIN_EVOLUTION|; \
       s|http://host.docker.internal:8000/webhook/whatsapp|https://$DOMAIN_AGENTS/webhook/whatsapp|; \
       s|evolution.aprender-aleman.de|$DOMAIN_EVOLUTION|" \
    "$REPO_DIR/whatsapp/.env.example" > "$REPO_DIR/whatsapp/.env"

  # Update root .env
  tmp="$(mktemp)"
  sed "s|^EVOLUTION_API_KEY=.*|EVOLUTION_API_KEY=$API_KEY|;
       s|^EVOLUTION_API_URL=.*|EVOLUTION_API_URL=https://$DOMAIN_EVOLUTION|" \
    "$REPO_DIR/.env" > "$tmp"
  mv "$tmp" "$REPO_DIR/.env"
  chown "$SERVICE_USER":"$SERVICE_USER" "$REPO_DIR/.env" "$REPO_DIR/whatsapp/.env"
fi

# ── 5. Python venv + deps ─────────────────────────────────
sudo -u "$SERVICE_USER" bash -lc "
  cd $REPO_DIR
  [ -d .venv ] || python3 -m venv .venv
  source .venv/bin/activate
  pip install --quiet --upgrade pip
  pip install --quiet -r agents/requirements.txt
"

# ── 6. Evolution API + Caddy ──────────────────────────────
sudo -u "$SERVICE_USER" bash -lc "
  cd $REPO_DIR/whatsapp
  docker compose --profile production up -d
"

echo "→ Waiting for Evolution API to be reachable on https://$DOMAIN_EVOLUTION…"
sleep 5

# ── 7. Agents systemd service ─────────────────────────────
cat >/etc/systemd/system/aa-agents.service <<EOF
[Unit]
Description=Aprender-Aleman.de agents (webhook server + scheduler)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=$REPO_DIR/.venv/bin/python -m agents.webhook_server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/aa-scheduler.service <<EOF
[Unit]
Description=Aprender-Aleman.de Agent 0 scheduler (lead watcher)
After=network.target aa-agents.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=$REPO_DIR/.venv/bin/python -m agents.agent_0_watcher
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
# Don't start yet — they depend on agents we build in later steps.
systemctl enable aa-agents.service aa-scheduler.service

echo
echo "=== VPS install done. ==="
echo
echo "Manual follow-up (required once):"
echo "  1. Point DNS A records for $DOMAIN_EVOLUTION and $DOMAIN_AGENTS at this VPS."
echo "  2. Run:   sudo -u $SERVICE_USER $REPO_DIR/.venv/bin/python $REPO_DIR/agents/scripts/bootstrap_whatsapp.py"
echo "     → opens a URL with the QR. Scan with WhatsApp on the +4915253409644 number."
echo "  3. Fill $REPO_DIR/.env with Supabase + Anthropic + Calendly credentials."
echo "  4. Start services:"
echo "       systemctl start aa-agents aa-scheduler"
echo "       systemctl status aa-agents aa-scheduler"
echo
