"""Deploy del fix del reviewer + tick manual inmediato."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)

def run(cmd, label="", timeout=600):
    print(f"\n══════════ {label or cmd[:60]} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

# 1. Upload
print("\n══════════ 1. Upload agent_2_reviewer.py ══════════")
sftp = client.open_sftp()
client.exec_command("cp /opt/b2c/agents/agent_2_reviewer.py /opt/b2c/agents/agent_2_reviewer.py.backup-$(date +%s)")
sftp.put("C:/Users/gelfi/Desktop/b2c/agents/agent_2_reviewer.py", "/opt/b2c/agents/agent_2_reviewer.py")
sftp.close()
print("  ✓ uploaded")

# 2. Rebuild + recreate scheduler (donde corre agent_0)
run("""
cd /opt/b2c/whatsapp
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -3
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_scheduler agents_webhook 2>&1 | tail -8
sleep 5
docker ps --filter 'name=aa_agents' --format 'table {{.Names}}\\t{{.Status}}'
""", label="2. Rebuild + recreate", timeout=600)

# 3. Forzar tick manual ahora mismo (no esperar al cron de :30)
run("""
echo '── 3a. Disparar agent_0.tick() manualmente ──'
docker exec aa_agents_scheduler python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
from agents.agent_0_watcher import tick
tick()
print('OK tick complete')
"
""", label="3. Tick manual", timeout=600)

# 4. Verificar resultado
run("""
echo '── 4a. Estado de los 4 leads tras tick ──'
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\\\"\\\"\\\"SELECT name, status, current_followup_number AS fu, reactivation_count AS rc, next_contact_date FROM leads WHERE name IN ('Mariam Chavarría','Laura','ona','Sara') ORDER BY name\\\"\\\"\\\")
    for r in cur.fetchall():
        print(f'  {r[\\\"name\\\"][:20]:20s}  status={r[\\\"status\\\"]:18s}  fu={r[\\\"fu\\\"]}  rc={r[\\\"rc\\\"]}  next={r[\\\"next_contact_date\\\"] and r[\\\"next_contact_date\\\"].isoformat()[:16]}')
"
echo
echo '── 4b. Mensajes enviados (message_send_log última hora) ──'
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\\\"\\\"\\\"SELECT sent_at, to_number, success, LEFT(message_body, 60) AS preview FROM message_send_log WHERE sent_at > NOW() - INTERVAL '15 minutes' ORDER BY sent_at DESC\\\"\\\"\\\")
    rows = list(cur.fetchall())
    print(f'  enviados última 15min: {len(rows)}')
    for r in rows: print(f'    {r[\\\"sent_at\\\"].isoformat()[11:19]}  to={r[\\\"to_number\\\"]}  ok={r[\\\"success\\\"]}  \\\"{r[\\\"preview\\\"]}\\\"')
"
""", label="4. Verificación")

client.close()
