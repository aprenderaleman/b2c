"""
Diagnóstico no-destructivo de la VPS de aprender-aleman.de.

Solo lee estado, logs, contenedores, env. No reinicia ni cambia nada.
"""
import io
import os
import sys
import paramiko

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = os.environ["VPS_HOST"]
USER = os.environ["VPS_USER"]
PASS = os.environ["VPS_PASS"]

CMDS = [
    ("systemd unit aa-agents",     "systemctl status aa-agents.service --no-pager -l || true"),
    ("systemd unit aa-scheduler",  "systemctl status aa-scheduler.service --no-pager -l || true"),
    ("aa-agents últimas 80 líneas","journalctl -u aa-agents.service -n 80 --no-pager || true"),
    ("aa-scheduler últimas 30",    "journalctl -u aa-scheduler.service -n 30 --no-pager || true"),
    ("docker ps",                  "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' || true"),
    ("evolution health",           "curl -s -o /dev/null -w 'http %{http_code}\\n' http://localhost:8080 || true"),
    ("agents health (caddy)",      "curl -s -o /dev/null -w 'http %{http_code}\\n' https://agents.aprender-aleman.de/healthz || true"),
    ("listen ports",               "ss -tlnp 2>/dev/null | grep -E ':(8000|8080|443|80)' || true"),
    ("env AGENTS_INTERNAL_SECRET set?", "grep -c '^AGENTS_INTERNAL_SECRET=' /opt/b2c/.env 2>/dev/null || echo 0"),
    ("caddy logs últimas 30",      "journalctl -u caddy.service -n 30 --no-pager || true"),
    ("aa-agents service file",     "cat /etc/systemd/system/aa-agents.service 2>/dev/null || true"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)

for label, cmd in CMDS:
    print(f"\n══════════ {label} ══════════")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

client.close()
