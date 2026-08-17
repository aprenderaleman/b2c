"""Investigar por qué Agent 4 no respondió a Christian + replay backlog Bayron."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd, label=""):
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=300, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

run(r"""
docker exec aa_agents_scheduler python -c "
import logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s %(levelname)s %(name)s %(message)s')

from agents.shared.db import get_conn
from agents.shared.leads import get_lead_by_id
from agents.agent_4_conversation import handle_incoming_message

# Christian
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"SELECT id, name, status FROM leads WHERE name = 'Christian' AND email LIKE '%aleman05%'\")
    row = cur.fetchone()
    print(f'Christian: id={row[\"id\"]} status={row[\"status\"]}')
    cur.execute(\"SELECT * FROM leads WHERE id = %s\", (row['id'],))
    lead = dict(cur.fetchone())

print()
print('=== Disparando handle_incoming_message con \"No responde\" ===')
result = handle_incoming_message(lead, 'No responde')
print(f'Result: {result}')
"
""", label="1. Disparar Agent 4 manualmente para Christian con su mensaje")

run(r"""
echo ''
echo '── Mensaje enviado? ──'
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"\"\"SELECT timestamp, type, author, LEFT(content, 100) AS content FROM lead_timeline WHERE lead_id = '1c744944-09f5-4dad-9c64-f10ff3a7e4f9' AND timestamp > NOW() - INTERVAL '1 hour' ORDER BY timestamp\"\"\")
    rows = list(cur.fetchall())
    for r in rows: print(f'  {r[\"timestamp\"].isoformat()[11:19]}  {r[\"type\"]:24s} by={r[\"author\"]}  \\\"{r[\"content\"]}\\\"')
    if not rows: print('  (nada)')
"
""", label="2. Verificar timeline post-tick")

# Ahora Bayron
run(r"""
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn

# Vincular LID conocido del bayron a la fila bayron en leads
# El LID en inbound_dedup que NO matchea ningún lead conocido y cae en ventana 06:11 → es de Bayron
# Pero el dedup solo guarda wa_message_id, no JID

# Mejor: borrar las 2 entradas dedup del 06:11, disparar inbound_replay para que Evolution
# nos lo reentregue, y como ahora la heuristica '_resolve_by_recent_outbound' funciona, debería resolver
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"DELETE FROM inbound_dedup WHERE wa_message_id IN ('AC0A9272C8C99AB95477824E7E00049D','ACC8F2FADEC9B08A85124D14F0D09B02') RETURNING wa_message_id\")
    deleted = cur.fetchall()
    print(f'Borradas {len(deleted)} entradas dedup')

print()
print('Disparando tick_inbound_replay()...')
from agents.whatsapp_health import tick_inbound_replay
result = tick_inbound_replay()
print(f'  resultado: {result}')
"
""", label="3. Replay Bayron (borrar dedup + replay)")

# Ahora ver Bayron
import time
time.sleep(8)
run(r"""
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"\"\"SELECT id, name, status, whatsapp_lid, current_followup_number AS fu FROM leads WHERE name='bayron'\"\"\")
    r = cur.fetchone()
    print(f'  Bayron: status={r[\"status\"]} lid={r[\"whatsapp_lid\"]} fu={r[\"fu\"]}')
    cur.execute(\"\"\"SELECT timestamp, type, author, LEFT(content,90) AS content FROM lead_timeline WHERE lead_id = %s AND timestamp > NOW() - INTERVAL '15 minutes' ORDER BY timestamp\"\"\", (r['id'],))
    rows = list(cur.fetchall())
    print(f'  Timeline última 15min ({len(rows)}):')
    for x in rows: print(f'    {x[\"timestamp\"].isoformat()[11:19]} {x[\"type\"]:25s} by={x[\"author\"]} \\\"{x[\"content\"]}\\\"')
"
""", label="4. Estado final Bayron post-replay")

client.close()
