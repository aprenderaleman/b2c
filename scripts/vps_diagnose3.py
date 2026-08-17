"""Round 3: docker-compose.vps.yml + .env del directorio del compose."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("compose project dir",        "ls -la /opt/b2c/whatsapp/"),
    ("docker-compose.vps.yml",     "cat /opt/b2c/whatsapp/docker-compose.vps.yml"),
    (".env keys (sin valores secretos)",
       "grep -E '^[A-Z_]+=' /opt/b2c/.env | awk -F= '{print $1\"=\"length($2)\" chars\"}'"),
    (".env: domain vars",
       "grep -E '^(AGENTS_DOMAIN|EVOLUTION_DOMAIN|AGENTS_BASE_URL|AGENTS_INTERNAL_SECRET)=' /opt/b2c/.env || true"),
    ("compose env file ref?",
       "head -50 /opt/b2c/whatsapp/docker-compose.vps.yml | grep -E 'env_file|environment' || true"),
    ("¿hay un .env en /opt/b2c/whatsapp/?",
       "ls -la /opt/b2c/whatsapp/.env 2>&1 || echo 'no .env aquí'"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=20)
for label, cmd in CMDS:
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=30, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)
client.close()
