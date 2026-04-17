#!/usr/bin/env bash
# ------------------------------------------------------------
# Aprender-Aleman.de — local dev one-shot launcher.
# Starts Evolution API (Docker), bootstraps the WhatsApp
# instance (opens QR in browser), then prints what's left to run.
#
# Usage (from repo root, in Git Bash on Windows or any bash):
#   bash scripts/start_local.sh
# ------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Aprender-Aleman.de local bootstrap ==="
echo

# 1. Check prerequisites.
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found — install Docker Desktop."; exit 1; }
command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || {
    echo "ERROR: python not found."; exit 1;
}

# 2. Set up .env files if missing.
if [ ! -f "$HERE/.env" ]; then
  echo "→ Creating .env from .env.example (you must fill in Supabase + Anthropic keys later)."
  cp "$HERE/.env.example" "$HERE/.env"
fi
if [ ! -f "$HERE/whatsapp/.env" ]; then
  echo "→ Creating whatsapp/.env with auto-generated API key."
  API_KEY="$(python -c 'import secrets;print(secrets.token_hex(32))')"
  DB_PASS="$(python -c 'import secrets;print(secrets.token_urlsafe(24))')"
  sed "s|change-me-to-a-long-random-string|$API_KEY|; s|change-me-too|$DB_PASS|" \
    "$HERE/whatsapp/.env.example" > "$HERE/whatsapp/.env"

  # Also export the same API key into root .env so the Python client picks it up.
  if grep -q '^EVOLUTION_API_KEY=' "$HERE/.env"; then
    # Portable in-place edit (macOS and Linux).
    tmp="$(mktemp)" && sed "s|^EVOLUTION_API_KEY=.*|EVOLUTION_API_KEY=$API_KEY|" "$HERE/.env" > "$tmp" && mv "$tmp" "$HERE/.env"
  else
    echo "EVOLUTION_API_KEY=$API_KEY" >> "$HERE/.env"
  fi
fi

# 3. Bring up Evolution stack.
echo "→ Starting Evolution API Docker stack…"
( cd "$HERE/whatsapp" && docker compose up -d )

# 4. Wait for Evolution to be healthy.
echo -n "→ Waiting for Evolution API"
for _ in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080" | grep -qE "200|401"; then
    echo " — up."
    break
  fi
  echo -n "."
  sleep 2
done

# 5. Install Python deps if venv exists, otherwise just try.
if [ ! -d "$HERE/.venv" ]; then
  echo "→ Creating Python virtualenv at .venv"
  python -m venv "$HERE/.venv"
fi
# shellcheck disable=SC1091
source "$HERE/.venv/Scripts/activate" 2>/dev/null || source "$HERE/.venv/bin/activate"
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r "$HERE/agents/requirements.txt"

# 6. Bootstrap the WhatsApp instance — opens QR in browser if needed.
echo "→ Bootstrapping WhatsApp instance…"
python "$HERE/agents/scripts/bootstrap_whatsapp.py"

echo
echo "=== Local setup done. ==="
echo
echo "Next steps:"
echo "  1. Funnel:   cd web && npm run dev           (http://localhost:3000)"
echo "  2. Agents:   python -m agents.webhook_server  (next build step)"
echo
