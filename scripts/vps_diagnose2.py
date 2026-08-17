"""Segundo round: por qué Coolify-proxy → aa_agents_webhook da 503 si el container está UP."""
import io, os, sys, paramiko

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

CMDS = [
    ("aa_agents_webhook logs (últimas 80)",
       "docker logs aa_agents_webhook --tail 80 2>&1 || true"),
    ("aa_agents_scheduler logs (últimas 50)",
       "docker logs aa_agents_scheduler --tail 50 2>&1 || true"),
    ("aa_agents_webhook inspect — ports + labels",
       "docker inspect aa_agents_webhook --format '{{json .Config.Labels}}{{println}}{{json .NetworkSettings.Networks}}{{println}}{{json .Config.ExposedPorts}}{{println}}{{json .State}}' 2>&1 || true"),
    ("test local: docker exec aa_agents_webhook curl localhost:8000/healthz",
       "docker exec aa_agents_webhook sh -c 'curl -s -o - -w \"\\nhttp %{http_code}\\n\" http://localhost:8000/healthz' 2>&1 || true"),
    ("redes Docker",
       "docker network ls"),
    ("¿en qué network está aa_agents_webhook?",
       "docker inspect aa_agents_webhook --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} ip={{$v.IPAddress}}{{println}}{{end}}'"),
    ("¿coolify-proxy está en la misma network?",
       "docker inspect coolify-proxy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} ip={{$v.IPAddress}}{{println}}{{end}}'"),
    ("test desde coolify-proxy → aa_agents_webhook:8000",
       "docker exec coolify-proxy sh -c 'wget -qO- --timeout=5 http://aa_agents_webhook:8000/healthz || echo FAIL'"),
    ("Caddyfile activo dentro de coolify-proxy (si existe)",
       "docker exec coolify-proxy sh -c 'caddy adapt --config /config/caddy/Caddyfile.json --pretty 2>/dev/null | head -200 || cat /config/caddy/Caddyfile 2>/dev/null || ls /config/caddy/' 2>&1 | head -100"),
    ("Coolify reverse-proxy config para agents",
       "docker exec coolify-proxy sh -c 'cat /traefik/dynamic/*.yaml 2>/dev/null || cat /etc/caddy/Caddyfile 2>/dev/null || ls /' 2>&1 | head -60"),
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
