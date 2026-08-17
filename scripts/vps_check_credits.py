"""Diagnostico tras restablecer creditos Anthropic.
1. Errores recientes en scheduler/webhook (busca 'credit', '529', 'rate', 'overloaded', 'billing').
2. Estado de la cola outbound_queue.
3. Estado de los leads agendados hoy.
4. Heartbeat: ultimo agent_0 tick + tick_absent_followups + drain_outbound.
"""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("Containers UP",
       "docker ps --filter 'name=aa_' --format 'table {{.Names}}\\t{{.Status}}'"),
    ("Errores Anthropic en scheduler (ultimas 200)",
       "docker logs aa_agents_scheduler --tail 500 2>&1 | grep -iE 'credit|billing|429|529|overloaded|insufficient|anthropic.*err|claude.*err|BadRequest' | tail -20 || echo '(sin errores)'"),
    ("Errores Anthropic en webhook (ultimas 500)",
       "docker logs aa_agents_webhook --tail 500 2>&1 | grep -iE 'credit|billing|429|529|overloaded|insufficient|anthropic.*err|claude.*err|BadRequest' | tail -20 || echo '(sin errores)'"),
    ("Send_failed con razon de API en lead_timeline",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('''SELECT timestamp, lead_id, content FROM lead_timeline WHERE type IN ('send_failed','agent_note') AND content ILIKE ANY(ARRAY['%credit%','%429%','%529%','%overloaded%','%anthropic%','%BadRequest%','%insufficient%']) AND timestamp > NOW() - INTERVAL '24 hours' ORDER BY timestamp DESC LIMIT 20''')\n    for r in cur.fetchall(): print(f'  {r[\\\"timestamp\\\"].isoformat()[:19]}  lead={str(r[\\\"lead_id\\\"])[:8]}  {r[\\\"content\\\"][:140]}')\n\""),
    ("agent_run_log ultimas 8h",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('''SELECT agent_name, started_at, leads_processed, errors_count, notes FROM agent_run_log WHERE started_at > NOW() - INTERVAL '8 hours' ORDER BY started_at DESC LIMIT 20''')\n    for r in cur.fetchall(): print(f'  {r[\\\"started_at\\\"].isoformat()[:19]}  {r[\\\"agent_name\\\"]}  proc={r[\\\"leads_processed\\\"]}  err={r[\\\"errors_count\\\"]}  notes={r[\\\"notes\\\"]}')\n\""),
    ("outbound_queue: estado actual",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('''SELECT status, COUNT(*) AS n, MIN(created_at) AS oldest FROM outbound_queue GROUP BY status''')\n    for r in cur.fetchall(): print(f'  {r[\\\"status\\\"]:18s} n={r[\\\"n\\\"]} oldest={(r[\\\"oldest\\\"] or 0) and r[\\\"oldest\\\"].isoformat()[:19]}')\n\""),
    ("Leads que agent_0 deberia procesar AHORA (next_contact_date <= NOW)",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute(\\\"\\\"\\\"SELECT id, name, status, current_followup_number, reactivation_count, next_contact_date FROM leads WHERE next_contact_date IS NOT NULL AND next_contact_date <= NOW() AND status NOT IN ('needs_human','converted','cold','lost','trial_scheduled','trial_reminded','trial_absent','absent_followup_1','absent_followup_2') AND (ai_paused_until IS NULL OR ai_paused_until <= NOW()) ORDER BY next_contact_date\\\"\\\"\\\")\n    rows = list(cur.fetchall())\n    print(f'  {len(rows)} leads due')\n    for r in rows: print(f'    {str(r[\\\"id\\\"])[:8]}  {r[\\\"name\\\"][:20]:20s}  status={r[\\\"status\\\"]}  fu={r[\\\"current_followup_number\\\"]}  rc={r[\\\"reactivation_count\\\"]}  next={r[\\\"next_contact_date\\\"].isoformat()[:16]}')\n\""),
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
