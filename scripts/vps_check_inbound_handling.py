"""Verificar que el bot esta procesando inbound (lead -> bot) correctamente."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("Inbound recientes (lead -> bot) ultimas 4h",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute(\\\"\\\"\\\"SELECT lt.timestamp, lt.lead_id, l.name, l.status, LEFT(lt.content, 100) AS content FROM lead_timeline lt JOIN leads l ON l.id = lt.lead_id WHERE lt.type = 'lead_message_received' AND lt.timestamp > NOW() - INTERVAL '4 hours' ORDER BY lt.timestamp DESC LIMIT 30\\\"\\\"\\\")\n    rows = list(cur.fetchall())\n    print(f'  {len(rows)} inbounds')\n    for r in rows: print(f'  {r[\\\"timestamp\\\"].isoformat()[11:19]}  lead={str(r[\\\"lead_id\\\"])[:8]}  {r[\\\"name\\\"][:18]:18s} status={r[\\\"status\\\"]:18s}  \\\"{r[\\\"content\\\"]}\\\"')\n\""),
    ("Outbound recientes (bot -> lead) ultimas 4h",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute(\\\"\\\"\\\"SELECT lt.timestamp, lt.lead_id, lt.author, l.name, LEFT(lt.content, 80) AS content FROM lead_timeline lt JOIN leads l ON l.id = lt.lead_id WHERE lt.type = 'system_message_sent' AND lt.timestamp > NOW() - INTERVAL '4 hours' ORDER BY lt.timestamp DESC LIMIT 30\\\"\\\"\\\")\n    rows = list(cur.fetchall())\n    print(f'  {len(rows)} outbounds')\n    for r in rows: print(f'  {r[\\\"timestamp\\\"].isoformat()[11:19]}  lead={str(r[\\\"lead_id\\\"])[:8]}  by={r[\\\"author\\\"]}  {r[\\\"name\\\"][:18]:18s}  \\\"{r[\\\"content\\\"][:70]}\\\"')\n\""),
    ("Webhook logs - eventos recibidos en ultima hora",
       "docker logs aa_agents_webhook --since '1h' 2>&1 | grep -iE 'WA webhook event|Duplicate inbound|WA msg|unmatched|background.*failed|error' | tail -40"),
    ("Inbound_dedup - filas recientes",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('SELECT wa_message_id, received_at FROM inbound_dedup WHERE received_at > NOW() - INTERVAL \\'2 hours\\' ORDER BY received_at DESC LIMIT 20')\n    for r in cur.fetchall(): print(f'  {r[\\\"received_at\\\"].isoformat()[11:19]}  {r[\\\"wa_message_id\\\"][:30]}')\n\""),
    ("Excepciones en webhook (ultima hora)",
       "docker logs aa_agents_webhook --since '1h' 2>&1 | grep -iE 'traceback|exception|handler failed|background handler' | tail -30 || echo '(none)'"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)
for label, cmd in CMDS:
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=60, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)
client.close()
