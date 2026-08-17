"""Por que agent_0 06:15 dijo proc=0 con due=3, y que paso con ona."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("Status actual de los 4 leads del backfill",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute(\\\"\\\"\\\"SELECT name, status, current_followup_number AS fu, reactivation_count AS rc, next_contact_date, ai_paused_until FROM leads WHERE name IN ('Mariam Chavarría','Laura','ona','Sara') ORDER BY name\\\"\\\"\\\")\n    for r in cur.fetchall(): print(f'  {r[\\\"name\\\"][:20]:20s}  status={r[\\\"status\\\"]:18s} fu={r[\\\"fu\\\"]} rc={r[\\\"rc\\\"]} next={r[\\\"next_contact_date\\\"] and r[\\\"next_contact_date\\\"].isoformat()[:16]}  paused_until={r[\\\"ai_paused_until\\\"] and r[\\\"ai_paused_until\\\"].isoformat()[:16]}')\n\""),
    ("Logs scheduler 06:00 y 06:15 — ¿qué dijeron Agent 1/2/3?",
       "docker logs aa_agents_scheduler --since '1h' 2>&1 | grep -iE 'agent_0|tick|nothing to send|rejected|blocked|Lead [0-9a-f]|sleep_until|outside.*window' | tail -60"),
    ("Cualquier excepción reciente",
       "docker logs aa_agents_scheduler --since '8h' 2>&1 | grep -iE 'traceback|exception|error' | tail -25"),
    ("rate_limits en .env",
       "grep -E 'MAX_|MIN_DELAY|MAX_DELAY|SEND_WINDOW|SKIP_SUNDAYS' /opt/b2c/.env"),
    ("Estado outbound_queue actual",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('SELECT id, status, kind, lead_id, retry_count, next_attempt_at, last_error FROM outbound_queue ORDER BY created_at DESC LIMIT 15')\n    rows = list(cur.fetchall())\n    print(f'  total: {len(rows)}')\n    for r in rows: print(f'    {r[\\\"status\\\"]:14s} kind={r[\\\"kind\\\"]} lead={str(r[\\\"lead_id\\\"])[:8] if r[\\\"lead_id\\\"] else None} retry={r[\\\"retry_count\\\"]} next={r[\\\"next_attempt_at\\\"] and r[\\\"next_attempt_at\\\"].isoformat()[:16]}')\n\""),
    ("rate_limits — counters por instancia",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('SELECT instance, count(*) FILTER(WHERE sent_at > NOW() - INTERVAL \\'1 hour\\') AS last_h, count(*) FILTER(WHERE sent_at::date = CURRENT_DATE) AS today FROM message_send_log GROUP BY instance')\n    for r in cur.fetchall(): print(f'  instance={r[\\\"instance\\\"]}  last_hour={r[\\\"last_h\\\"]}  today={r[\\\"today\\\"]}')\n\""),
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
