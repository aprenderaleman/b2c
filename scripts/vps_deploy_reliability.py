"""Deploy completo del plan de reliability."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

FILES = [
    ("agents/notifications.py",       "/opt/b2c/agents/notifications.py"),
    ("agents/scheduler.py",            "/opt/b2c/agents/scheduler.py"),
    ("agents/webhook_server.py",       "/opt/b2c/agents/webhook_server.py"),
    ("agents/whatsapp_health.py",      "/opt/b2c/agents/whatsapp_health.py"),
    ("agents/agent_4_conversation.py", "/opt/b2c/agents/agent_4_conversation.py"),
    ("agents/synthetic_monitor.py",    "/opt/b2c/agents/synthetic_monitor.py"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)

def run(cmd, label=""):
    print(f"\n══════════ {label or cmd[:60]} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=600, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

print("\n══════════ 1. Upload 6 archivos ══════════")
sftp = client.open_sftp()
for local, remote in FILES:
    full_local = "C:/Users/gelfi/Desktop/b2c/" + local
    client.exec_command(f"cp {remote} {remote}.backup-$(date +%s) 2>/dev/null || true")
    sftp.put(full_local, remote)
    print(f"  ✓ {local}")
sftp.close()

run("""
cd /opt/b2c/whatsapp
echo '── Rebuild ──'
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -3
echo '── Recreate ──'
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook agents_scheduler 2>&1 | tail -8
sleep 6
docker ps --filter 'name=aa_agents' --format 'table {{.Names}}\\t{{.Status}}'
""", label="2. Rebuild + recreate")

run("""
echo '── Healthz ──'
curl -s -w '\\nhttp %{http_code}\\n' https://agents.aprender-aleman.de/healthz
echo
echo '── Scheduler arrancó con N jobs (esperamos 16: 12 originales + 1 drain inbound + 3 watchdogs) ──'
docker logs aa_agents_scheduler --tail 80 2>&1 | grep -E 'Scheduler started|Adding job|Added job' | tail -25
echo
echo '── Errores recientes ──'
docker logs aa_agents_scheduler --tail 40 2>&1 | grep -iE 'error|exception|traceback' | tail -10 || echo '(sin errores)'
""", label="3. Validación")

run("""
echo '── Test synthetic ad-hoc ──'
docker exec aa_agents_scheduler python -c "
from agents.synthetic_monitor import run_synthetic_check
result = run_synthetic_check()
print(f'  resultado: {result}')
"
""", label="4. Disparar test sintético una vez")

run("""
echo '── Watchdogs activos ──'
docker exec aa_agents_scheduler python -c "
from agents.notifications import scan_silent_inbounds_and_alert, scan_unmatched_lids_and_alert, scan_evolution_health_and_alert
print(f'  silent_inbound watchdog → alertados: {scan_silent_inbounds_and_alert()}')
print(f'  unmatched_lid watchdog → alertados: {scan_unmatched_lids_and_alert()}')
print(f'  evolution_health watchdog → alertados: {scan_evolution_health_and_alert()}')
"
""", label="5. Probar los 3 watchdogs ahora mismo")

client.close()
