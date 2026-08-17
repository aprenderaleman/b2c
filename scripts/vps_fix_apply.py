"""
Fix EN VIVO en la VPS:
  Bug 1 (CRÍTICO): añadir AGENTS_DOMAIN + EVOLUTION_DOMAIN a /opt/b2c/whatsapp/.env
                   para que la interpolación de labels Traefik funcione, y
                   recrear los containers (las labels se fijan en docker create).
  Bug 2 (silencioso): subir agents/scheduler.py corregido (whatsapp_e164 → phone),
                      reconstruir imagen aa_agents:latest, recrear scheduler.

Validación al final: probar https://agents.aprender-aleman.de/healthz desde el VPS.
"""
import io, os, sys, time
import paramiko

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)

def run(cmd: str, *, label: str = "", timeout: int = 600) -> int:
    print(f"\n══════════ {label or cmd[:60]} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)
    rc = stdout.channel.recv_exit_status()
    print(f"\n   ↳ exit={rc}")
    return rc

# ─── Bug 1: añadir las dos variables al .env del compose ──────────────────
run("""
set -e
cd /opt/b2c/whatsapp
cp .env .env.backup-$(date +%s)
# Añadir solo si no existen ya
grep -q '^AGENTS_DOMAIN=' .env || echo 'AGENTS_DOMAIN=agents.aprender-aleman.de' >> .env
grep -q '^EVOLUTION_DOMAIN=' .env || echo 'EVOLUTION_DOMAIN=evolution.aprender-aleman.de' >> .env
echo '── nuevo .env del compose ──'
cat .env
""", label="Bug 1: añadir domain vars a /opt/b2c/whatsapp/.env")

# ─── Subir el scheduler.py corregido (Bug 2) ──────────────────────────────
print("\n══════════ Bug 2: subiendo scheduler.py corregido ══════════")
sftp = client.open_sftp()
local = "C:/Users/gelfi/Desktop/b2c/agents/scheduler.py"
remote = "/opt/b2c/agents/scheduler.py"
# Backup primero
client.exec_command(f"cp {remote} {remote}.backup-$(date +%s)")
sftp.put(local, remote)
sftp.close()
print(f"  ✓ {local} → {remote}")

run("grep -n 'tu.phone\\|tu.whatsapp_e164' /opt/b2c/agents/scheduler.py | head -5",
    label="Verifico que el cambio quedó aplicado")

# ─── Recrear los containers para que las nuevas labels se fijen y el código nuevo se aplique ──
run("""
cd /opt/b2c/whatsapp
echo '── 1. rebuild imagen aa_agents:latest (incluye scheduler.py nuevo) ──'
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -20
echo
echo '── 2. recrear los 3 containers (force-recreate para fijar labels nuevas) ──'
docker compose -f docker-compose.vps.yml up -d --force-recreate evolution_api agents_webhook agents_scheduler 2>&1 | tail -20
echo
echo '── 3. esperar 8s para que arranquen ──'
sleep 8
docker ps --filter 'name=aa_' --format 'table {{.Names}}\t{{.Status}}'
""", label="Aplicar fixes (rebuild + force-recreate)", timeout=600)

# ─── Validación ──────────────────────────────────────────────────────────
run("""
echo '── labels Traefik tras recreate ──'
docker inspect aa_agents_webhook --format '{{index .Config.Labels "traefik.http.routers.aa-agents-https.rule"}}'
docker inspect aa_evolution      --format '{{index .Config.Labels "traefik.http.routers.aa-evolution-https.rule"}}'
echo
echo '── healthz desde el VPS (pasa por Traefik público) ──'
curl -s -o - -w '\\n→ http %{http_code}\\n' https://agents.aprender-aleman.de/healthz
echo
echo '── log scheduler últimas 30 líneas (sin errores de whatsapp_e164) ──'
docker logs aa_agents_scheduler --tail 30 2>&1 | grep -v 'drain_outbound' | tail -20
""", label="Validación final")

client.close()
