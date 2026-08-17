"""Round 4: comparar labels Evolution vs agents_webhook + ver el .env del compose dir."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("evolution labels traefik",
       "docker inspect aa_evolution --format '{{range $k,$v := .Config.Labels}}{{if (or (eq (slice $k 0 7) \"traefik\") (eq $k \"traefik.enable\"))}}{{$k}}={{$v}}{{println}}{{end}}{{end}}' 2>&1 || true"),
    ("agents_webhook labels traefik",
       "docker inspect aa_agents_webhook --format '{{range $k,$v := .Config.Labels}}{{if (or (eq (slice $k 0 7) \"traefik\") (eq $k \"traefik.enable\"))}}{{$k}}={{$v}}{{println}}{{end}}{{end}}' 2>&1 || true"),
    ("contenido /opt/b2c/whatsapp/.env",
       "cat /opt/b2c/whatsapp/.env"),
    ("StartedAt + creación de containers",
       "docker inspect aa_evolution aa_agents_webhook aa_agents_scheduler --format '{{.Name}} created={{.Created}} startedAt={{.State.StartedAt}}'"),
    ("agents en networks coolify? ip de coolify-proxy",
       "docker inspect coolify-proxy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}}{{println}}{{end}}'"),
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
