"""Deploy pre_send_guard a la VPS — Fase 1 incidente Asmaa."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

FILES = [
    ("agents/shared/pre_send_guard.py", "/opt/b2c/agents/shared/pre_send_guard.py"),
    ("agents/agent_3_sender.py",         "/opt/b2c/agents/agent_3_sender.py"),
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

print("\n══════════ 1. Subiendo archivos ══════════")
sftp = client.open_sftp()
for local, remote in FILES:
    full_local = "C:/Users/gelfi/Desktop/b2c/" + local
    client.exec_command(f"cp {remote} {remote}.backup-$(date +%s) 2>/dev/null || true")
    sftp.put(full_local, remote)
    print(f"  ✓ {local}")
sftp.close()

run("""
cd /opt/b2c/whatsapp
echo '── Rebuild agents containers ──'
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -3
echo '── Recreate ──'
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook 2>&1 | tail -5
sleep 4
echo '── Logs (debe arrancar limpio) ──'
docker logs --tail 30 aa_agents_webhook 2>&1
""", "Rebuild + restart")

run("""
echo '── Smoke: import del módulo en el contenedor ──'
docker exec aa_agents_webhook python -c "from agents.shared.pre_send_guard import check_can_send; print('IMPORT OK', check_can_send.__doc__[:60])"
""", "Smoke import")

client.close()
print("\n✓ Deploy completado")
