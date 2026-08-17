"""Deploy del fix de duplicación de mensajes.

1. Sube los 3 archivos modificados al VPS
2. Rebuild de la imagen aa_agents:latest
3. Recreate de los containers webhook + scheduler
4. Validación: los 2 containers vivos, healthz 200, log sin errores
"""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

FILES = [
    ("C:/Users/gelfi/Desktop/b2c/agents/webhook_server.py",  "/opt/b2c/agents/webhook_server.py"),
    ("C:/Users/gelfi/Desktop/b2c/agents/whatsapp_health.py", "/opt/b2c/agents/whatsapp_health.py"),
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
print("\n══════════ 1. Backup + upload de los 3 archivos ══════════")
sftp = client.open_sftp()
for local, remote in FILES:
    client.exec_command(f"cp {remote} {remote}.backup-$(date +%s)")
    sftp.put(local, remote)
    print(f"  ✓ {local.split('/')[-1]} → {remote}")
sftp.close()

# 2. Verificar que los cambios llegaron
run("grep -n 'inbound_dedup\\|BackgroundTasks\\|_claim_inbound' /opt/b2c/agents/webhook_server.py | head -8",
    label="2. Verificar webhook_server.py tiene los cambios")
run("grep -n 'inbound_dedup\\|_claim_inbound_for_replay' /opt/b2c/agents/whatsapp_health.py | head -6",
    label="   Verificar whatsapp_health.py tiene los cambios")
run("grep -n 'inbound_dedup\\|_cleanup_inbound_dedup' /opt/b2c/agents/scheduler.py | head -8",
    label="   Verificar scheduler.py tiene los cambios")

# 3. Rebuild + recreate
run("""
cd /opt/b2c/whatsapp
echo '── 3a. Rebuild aa_agents:latest ──'
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -5
echo
echo '── 3b. Recreate webhook + scheduler ──'
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook agents_scheduler 2>&1 | tail -10
echo
sleep 6
docker ps --filter 'name=aa_agents' --format 'table {{.Names}}\\t{{.Status}}'
""", label="3. Rebuild + recreate", timeout=600)

# 4. Validación
run("""
echo '── 4a. healthz ──'
curl -s -w '\\nhttp %{http_code}\\n' https://agents.aprender-aleman.de/healthz
echo
echo '── 4b. logs webhook (últimas 30) ──'
docker logs aa_agents_webhook --tail 30 2>&1
echo
echo '── 4c. logs scheduler — buscar inbound_dedup_cleanup en los jobs ──'
docker logs aa_agents_scheduler --tail 80 2>&1 | grep -E 'job|Scheduler|inbound_dedup|error' | head -25
""", label="4. Validación post-deploy")

client.close()
