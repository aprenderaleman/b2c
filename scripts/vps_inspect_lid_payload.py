"""Capturar el payload completo de un LID inbound + ver el estado de los leads."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("¿Quién tiene whatsapp_lid setteado?",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute('SELECT id, name, whatsapp_normalized, whatsapp_lid, status FROM leads WHERE whatsapp_lid IS NOT NULL')\n    rows = list(cur.fetchall())\n    print(f'  {len(rows)} leads con whatsapp_lid')\n    for r in rows: print(f'    {str(r[\\\"id\\\"])[:8]}  {r[\\\"name\\\"][:18]:18s} phone={r[\\\"whatsapp_normalized\\\"]:18s} lid={r[\\\"whatsapp_lid\\\"]} status={r[\\\"status\\\"]}')\n\""),
    ("¿Qué leads recibieron mensaje hoy?",
       "docker exec aa_agents_scheduler python -c \"\nfrom agents.shared.db import get_conn\nwith get_conn() as conn, conn.cursor() as cur:\n    cur.execute(\\\"\\\"\\\"SELECT msl.sent_at, msl.to_number, l.id, l.name, l.whatsapp_lid, l.status FROM message_send_log msl LEFT JOIN leads l ON l.whatsapp_normalized = msl.to_number WHERE msl.sent_at > NOW() - INTERVAL '4 hours' AND msl.success = TRUE ORDER BY msl.sent_at DESC\\\"\\\"\\\")\n    for r in cur.fetchall(): print(f'  {r[\\\"sent_at\\\"].isoformat()[11:19]}  to={r[\\\"to_number\\\"]:18s} lead={r[\\\"name\\\"] and r[\\\"name\\\"][:18]:18s} lid={r[\\\"whatsapp_lid\\\"]} status={r[\\\"status\\\"]}')\n\""),
    ("Consultar Evolution: ¿devuelve mapping LID→phone?",
       "curl -s -H \"apikey: $(grep ^EVOLUTION_API_KEY= /opt/b2c/.env | cut -d= -f2)\" 'https://evolution.aprender-aleman.de/chat/findContacts/aprender-aleman-main' -X POST -H 'Content-Type: application/json' -d '{\"where\":{}}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f\"  total contacts: {len(d) if isinstance(d,list) else 0}\"); [print(f\"  jid={c.get(chr(34)+\\\"id\\\"+chr(34))} pushName={c.get(chr(34)+\\\"pushName\\\"+chr(34))}\") for c in (d[:8] if isinstance(d,list) else [])]'"),
    ("Activar log DEBUG en webhook para ver payload completo",
       "docker exec aa_agents_webhook python -c \"\nimport json\n# simular que Evolution nos manda un payload de LID con todos sus campos\n# para ver qué keys existen\nfrom agents.webhook_server import _handle_whatsapp_message\nimport agents.webhook_server as w\nimport logging\n\norig = w._handle_whatsapp_message\ndef wrap(payload):\n    print('FULL PAYLOAD:', json.dumps(payload, default=str, indent=2)[:2000])\n    return orig(payload)\nw._handle_whatsapp_message = wrap\nprint('hook installed (este print solo demuestra que tenemos acceso)')\n\""),
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
