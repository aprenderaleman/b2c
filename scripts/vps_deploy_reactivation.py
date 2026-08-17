"""Deploy del fix de reactivacion de leads post-engagement.

1. Sube los 5 archivos modificados (+ migracion 041 ya aplicada en DB)
2. Rebuild de la imagen aa_agents:latest
3. Recreate de webhook + scheduler
4. Validacion: containers vivos, healthz 200, scheduler con 12 jobs (era 11)
"""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

FILES = [
    ("C:/Users/gelfi/Desktop/b2c/agents/shared/leads.py",    "/opt/b2c/agents/shared/leads.py"),
    ("C:/Users/gelfi/Desktop/b2c/agents/agent_1_writer.py",  "/opt/b2c/agents/agent_1_writer.py"),
    ("C:/Users/gelfi/Desktop/b2c/agents/agent_0_watcher.py", "/opt/b2c/agents/agent_0_watcher.py"),
    ("C:/Users/gelfi/Desktop/b2c/agents/agent_4_conversation.py", "/opt/b2c/agents/agent_4_conversation.py"),
    ("C:/Users/gelfi/Desktop/b2c/agents/scheduler.py",       "/opt/b2c/agents/scheduler.py"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)

def run(cmd, label="", timeout=600):
    print(f"\n══════════ {label or cmd[:60]} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)
    rc = stdout.channel.recv_exit_status()
    print(f"\n   ↳ exit={rc}")
    return rc

# 1. Backups + upload
print("\n══════════ 1. Backup + upload de los 5 archivos ══════════")
sftp = client.open_sftp()
for local, remote in FILES:
    client.exec_command(f"cp {remote} {remote}.backup-$(date +%s)")
    sftp.put(local, remote)
    print(f"  ✓ {local.split('/')[-1]} → {remote}")
sftp.close()

# 2. Rebuild + recreate
run("""
cd /opt/b2c/whatsapp
echo '── 2a. Rebuild aa_agents:latest ──'
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -5
echo
echo '── 2b. Recreate webhook + scheduler ──'
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook agents_scheduler 2>&1 | tail -8
echo
sleep 6
docker ps --filter 'name=aa_agents' --format 'table {{.Names}}\\t{{.Status}}'
""", label="2. Rebuild + recreate", timeout=600)

# 3. Validación
run("""
echo '── 3a. healthz ──'
curl -s -w '\\nhttp %{http_code}\\n' https://agents.aprender-aleman.de/healthz
echo
echo '── 3b. log scheduler — debe arrancar con 12 jobs (era 11) ──'
docker logs aa_agents_scheduler --tail 80 2>&1 | grep -E 'Scheduler started|Adding job|reactivate_orphaned' | tail -16
echo
echo '── 3c. errores recientes ──'
docker logs aa_agents_scheduler --tail 30 2>&1 | grep -iE 'error|exception|traceback' | tail -10 || echo '(sin errores)'
""", label="3. Validación post-deploy")

client.close()
