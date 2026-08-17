"""Validación end-to-end tras los fixes."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("/healthz desde fuera (HTTPS Traefik)",
       "curl -s -w '\\nhttp %{http_code}\\n' https://agents.aprender-aleman.de/healthz"),
    ("/internal/whatsapp-status (con secret)",
       "curl -s -w '\\nhttp %{http_code}\\n' -H \"X-Internal-Secret: $(grep ^AGENTS_INTERNAL_SECRET= /opt/b2c/.env | cut -d= -f2)\" https://agents.aprender-aleman.de/internal/whatsapp-status"),
    ("estado conexión WhatsApp (Evolution API directo)",
       "curl -s -H \"apikey: $(grep ^EVOLUTION_API_KEY= /opt/b2c/.env | cut -d= -f2)\" https://evolution.aprender-aleman.de/instance/connectionState/aprender-aleman-main"),
    ("webhook configurado en Evolution para nuestra instancia",
       "curl -s -H \"apikey: $(grep ^EVOLUTION_API_KEY= /opt/b2c/.env | cut -d= -f2)\" https://evolution.aprender-aleman.de/webhook/find/aprender-aleman-main"),
    ("self-heal: ¿tick_webhook_self_heal corrió?",
       "docker logs aa_agents_scheduler --tail 200 2>&1 | grep -iE 'webhook|self_heal|webhook_self' | tail -10"),
    ("scheduler: ¿algún error reciente?",
       "docker logs aa_agents_scheduler --tail 80 2>&1 | grep -iE 'error|exception|traceback' | tail -15 || echo '(sin errores)'"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)
for label, cmd in CMDS:
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=30, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)
client.close()
