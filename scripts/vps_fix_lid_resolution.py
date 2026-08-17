"""Deploy del fix LID + backfill: vincular LID 111132345938077 a Sara y reprocesar
los 2 inbounds (corazon ♥️) que se perdieron como unmatched."""
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

# 1. Upload webhook_server.py
print("\n══════════ 1. Upload webhook_server.py ══════════")
sftp = client.open_sftp()
client.exec_command("cp /opt/b2c/agents/webhook_server.py /opt/b2c/agents/webhook_server.py.backup-$(date +%s)")
sftp.put("C:/Users/gelfi/Desktop/b2c/agents/webhook_server.py", "/opt/b2c/agents/webhook_server.py")
sftp.close()
print("  ✓ uploaded")

# 2. Rebuild + recreate
run("""
cd /opt/b2c/whatsapp
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -3
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook agents_scheduler 2>&1 | tail -8
sleep 5
docker ps --filter 'name=aa_agents' --format 'table {{.Names}}\\t{{.Status}}'
""", label="2. Rebuild + recreate", timeout=600)

# 3. Backfill: vincular LID a Sara + borrar dedup + trigger replay
run("""
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
LID = '111132345938077@lid'

with get_conn() as conn, conn.cursor() as cur:
    # Sara
    cur.execute(\\\"SELECT id, name, whatsapp_normalized, whatsapp_lid FROM leads WHERE name = 'Sara' LIMIT 1\\\")
    sara = cur.fetchone()
    print(f'Sara antes: lid={sara[\\\"whatsapp_lid\\\"]}')

    # Vincular LID a Sara
    cur.execute(\\\"UPDATE leads SET whatsapp_lid = %s WHERE id = %s\\\", (LID, sara['id']))
    print(f'  → LID {LID} vinculado a Sara')

    # Borrar dedup entries para que el replay los reprocese
    cur.execute(\\\"DELETE FROM inbound_dedup WHERE wa_message_id IN ('3A1C9402021C68C8C2D7','3A8D72D1D9132DB1D1A8') RETURNING wa_message_id\\\")
    deleted = cur.fetchall()
    print(f'  → {len(deleted)} entries borrados de inbound_dedup')

print()
# Trigger replay manualmente
print('Disparando tick_inbound_replay()...')
from agents.whatsapp_health import tick_inbound_replay
result = tick_inbound_replay()
print(f'  resultado: {result}')
"
""", label="3. Backfill Sara + replay", timeout=120)

# 4. Verificar
run("""
sleep 8
echo '── 4a. Sara tras replay (debería tener inbounds + outbound nuevo) ──'
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\\\"SELECT id, name, status, whatsapp_lid, reactivation_count FROM leads WHERE name='Sara'\\\")
    s = cur.fetchone()
    print(f'  Sara: status={s[\\\"status\\\"]}  lid={s[\\\"whatsapp_lid\\\"]}  rc={s[\\\"reactivation_count\\\"]}')
    cur.execute(\\\"SELECT timestamp, type, author, LEFT(content, 80) AS content FROM lead_timeline WHERE lead_id = %s ORDER BY timestamp DESC LIMIT 6\\\", (s['id'],))
    print(f'  Últimos 6 eventos timeline:')
    for r in cur.fetchall():
        print(f'    {r[\\\"timestamp\\\"].isoformat()[11:19]}  {r[\\\"type\\\"]:25s} by={r[\\\"author\\\"] or \\\"-\\\"}  \\\"{r[\\\"content\\\"]}\\\"')
"

echo
echo '── 4b. Webhook log último minuto (debe mostrar el LID resuelto) ──'
docker logs aa_agents_webhook --since '2m' 2>&1 | grep -iE 'LID.*bound|recent-outbound|webhook event|WA msg|unmatched' | tail -15
""", label="4. Verificación")

client.close()
