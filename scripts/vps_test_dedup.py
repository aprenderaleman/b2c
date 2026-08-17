"""Test live: enviar el mismo key.id dos veces. La 2da debe dar duplicate=true."""
import io, os, sys, paramiko, json, time
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)

KEY_ID = f"TESTDEDUP_{int(time.time())}"
print(f"Test key.id = {KEY_ID}\n")

PAYLOAD = json.dumps({
    "event": "messages.upsert",
    "data": {
        "key": {"id": KEY_ID, "remoteJid": "1555TESTDEDUP@s.whatsapp.net", "fromMe": False},
        "pushName": "DedupTest",
        "message": {"conversation": "test 1"},
        "sender": "1555TESTDEDUP",
    }
}).replace("'", "'\\''")

CMD = f"""
echo '── 1ra POST con key.id={KEY_ID} ──'
curl -s -w '\\nhttp %{{http_code}}\\n' \\
  -H 'Content-Type: application/json' \\
  -d '{PAYLOAD}' \\
  https://agents.aprender-aleman.de/webhook/whatsapp
echo
echo '── 2da POST IDENTICA (debe ser dedup) ──'
curl -s -w '\\nhttp %{{http_code}}\\n' \\
  -H 'Content-Type: application/json' \\
  -d '{PAYLOAD}' \\
  https://agents.aprender-aleman.de/webhook/whatsapp
echo
echo '── 3ra POST IDENTICA (tambien dedup) ──'
curl -s -w '\\nhttp %{{http_code}}\\n' \\
  -H 'Content-Type: application/json' \\
  -d '{PAYLOAD}' \\
  https://agents.aprender-aleman.de/webhook/whatsapp
sleep 1
echo
echo '── Estado en inbound_dedup ──'
docker exec aa_agents_webhook python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\\"SELECT wa_message_id, received_at FROM inbound_dedup WHERE wa_message_id = '{KEY_ID}'\\")
    print('  fila en DB:', cur.fetchone())
"
echo
echo '── Webhook log: ¿qué procesó? ──'
docker logs aa_agents_webhook --tail 20 2>&1 | grep -E 'Duplicate|webhook event|key.id' | tail -10
"""

_, stdout, _ = client.exec_command(CMD, timeout=60, get_pty=True)
for line in iter(stdout.readline, ""):
    if not line: break
    print(line, end="", flush=True)

client.close()
