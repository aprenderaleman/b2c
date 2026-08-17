"""Dry-run dentro del container: compose_message para los 4 leads atascados.
NO envia nada — solo invoca compose_message y muestra el draft que saldria."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMD = """
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
from agents.agent_1_writer import compose_message

with get_conn() as conn, conn.cursor() as cur:
    cur.execute('''
        SELECT id, name, whatsapp_normalized, language, german_level, goal, urgency,
               status, current_followup_number, next_contact_date, messages_seen_count,
               reactivation_count, ai_paused_until
          FROM leads
         WHERE name IN ('Mariam Chavarría','Laura','ona','Sara')
         ORDER BY name
    ''')
    leads = list(cur.fetchall())

for lead in leads:
    print(f'\\n── {lead[\\\"name\\\"]} ({lead[\\\"status\\\"]}, rc={lead[\\\"reactivation_count\\\"]}) ──')
    draft = compose_message(dict(lead))
    if draft is None:
        print('   ⚠ compose_message returned None — bug!')
    else:
        print(f'   kind: {draft.kind}')
        print(f'   text:')
        for line in draft.text.split(chr(10)):
            print(f'     | {line}')
"
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)
_, stdout, _ = client.exec_command(CMD, timeout=60, get_pty=True)
for line in iter(stdout.readline, ""):
    if not line: break
    print(line, end="", flush=True)
client.close()
