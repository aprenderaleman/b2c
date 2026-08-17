"""Deploy ventana LID 6h + replay Bayron."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd, label=""):
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=600, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

print("\n══════════ Upload webhook_server.py ══════════")
sftp = client.open_sftp()
client.exec_command("cp /opt/b2c/agents/webhook_server.py /opt/b2c/agents/webhook_server.py.backup-$(date +%s)")
sftp.put("C:/Users/gelfi/Desktop/b2c/agents/webhook_server.py", "/opt/b2c/agents/webhook_server.py")
sftp.close()
print("  ✓ uploaded")

run("""
cd /opt/b2c/whatsapp
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -3
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook agents_scheduler 2>&1 | tail -8
sleep 5
""", label="Rebuild + recreate")

run(r"""
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn

# Vincular el LID 228407031890130 directamente a Bayron
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"SELECT id FROM leads WHERE name = 'bayron'\")
    bayron_id = cur.fetchone()['id']
    cur.execute(\"UPDATE leads SET whatsapp_lid = '228407031890130@lid' WHERE id = %s\", (bayron_id,))
    print(f'  Bayron lid setteado')
    # Borrar entradas dedup correspondientes (solo las 2 que vimos antes)
    cur.execute(\"\"\"DELETE FROM inbound_dedup WHERE wa_message_id IN
                  ('AC0A9272C8C99AB95477824E7E00049D','ACC8F2FADEC9B08A85124D14F0D09B02')\"\"\")

print()
print('Disparando tick_inbound_replay()...')
from agents.whatsapp_health import tick_inbound_replay
print(tick_inbound_replay())
"
""", label="Bayron: vincular LID + replay")

import time; time.sleep(10)

run(r"""
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"\"\"SELECT timestamp, type, author, LEFT(content, 100) AS content FROM lead_timeline lt JOIN leads l ON l.id = lt.lead_id WHERE l.name = 'bayron' AND timestamp > NOW() - INTERVAL '20 minutes' ORDER BY timestamp\"\"\")
    rows = list(cur.fetchall())
    print(f'  Timeline Bayron últimos 20min ({len(rows)}):')
    for r in rows: print(f'    {r[\"timestamp\"].isoformat()[11:19]}  {r[\"type\"]:24s} by={r[\"author\"]:8s}  \\\"{r[\"content\"]}\\\"')
"
""", label="Resultado final")

client.close()
