"""Investigar por qué Christian no recibió respuesta a 'Ja' (20:30) y 'No responde' (20:41)."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("Logs webhook 29-abr 20:25 → 20:50 UTC (= 22:25-22:50 CEST)",
       "docker logs aa_agents_webhook --since '2026-04-29T22:25:00' --until '2026-04-29T22:55:00' 2>&1 | tail -150"),
    ("Excepciones 29-abr noche",
       "docker logs aa_agents_webhook --since '2026-04-29T22:00:00' 2>&1 | grep -iE 'traceback|exception|error|failed' | tail -30 || echo '(none)'"),
    ("¿Bayron tiene un LID en algun lugar?",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute(\\\"SELECT wa_message_id, received_at FROM inbound_dedup WHERE received_at > NOW() - INTERVAL '4 hours' ORDER BY received_at DESC\\\")\n    for r in cur.fetchall(): print(f'  {r[\\\"received_at\\\"].isoformat()[11:19]}  {r[\\\"wa_message_id\\\"]}')\n\""),
    ("Logs webhook 30-abr 06:00 → 06:20 (cuando Bayron respondió)",
       "docker logs aa_agents_webhook --since '2026-04-30T08:00:00' --until '2026-04-30T08:20:00' 2>&1 | grep -iE 'WA msg|unmatched|LID|webhook event' | tail -40"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)
for label, cmd in CMDS:
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=60, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)
client.close()
