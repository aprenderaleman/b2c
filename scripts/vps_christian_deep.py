"""Disparar Agent 4 manualmente con el msg de Christian para ver toda la traza."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMD = r"""
docker exec aa_agents_scheduler python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')

from agents.shared.db import get_conn
from agents.agent_4_conversation import handle_incoming_message

# Buscar Christian (el de el_aleman05@icloud.com)
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\"\"\"SELECT * FROM leads WHERE name = 'Christian' AND email = 'el_aleman05@icloud.com'\"\"\")
    row = cur.fetchone()
    if not row:
        cur.execute(\"\"\"SELECT * FROM leads WHERE name = 'Christian' ORDER BY created_at DESC LIMIT 1\"\"\")
        row = cur.fetchone()
    lead = dict(row)
    print(f'Christian: id={lead[\"id\"]}  status={lead[\"status\"]}  language={lead[\"language\"]}')

print()
print('=== Disparando handle_incoming_message con \"Ja\" ===')
result = handle_incoming_message(lead, 'Ja')
print()
print(f'Result: {result}')
"
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)
_, stdout, _ = client.exec_command(CMD, timeout=120, get_pty=True)
for line in iter(stdout.readline, ""):
    if not line: break
    print(line, end="", flush=True)
client.close()
