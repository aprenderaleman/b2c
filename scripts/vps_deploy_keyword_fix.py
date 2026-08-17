"""Deploy del fix de keywords (negative ampliado + booking restringido)."""
import io, os, sys, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd, label=""):
    print(f"\n══════════ {label or cmd[:60]} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=600, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

print("\n══════════ 1. Upload agent_4_conversation.py ══════════")
sftp = client.open_sftp()
client.exec_command("cp /opt/b2c/agents/agent_4_conversation.py /opt/b2c/agents/agent_4_conversation.py.backup-$(date +%s)")
sftp.put("C:/Users/gelfi/Desktop/b2c/agents/agent_4_conversation.py", "/opt/b2c/agents/agent_4_conversation.py")
sftp.close()
print("  ✓ uploaded")

run("""
cd /opt/b2c/whatsapp
docker compose -f docker-compose.vps.yml build agents_webhook 2>&1 | tail -3
docker compose -f docker-compose.vps.yml up -d --force-recreate agents_webhook agents_scheduler 2>&1 | tail -8
sleep 5
docker ps --filter 'name=aa_agents' --format 'table {{.Names}}\\t{{.Status}}'
""", label="2. Rebuild + recreate")

run("""
echo '── 3a. Test in-container del nuevo keyword logic ──'
docker exec aa_agents_scheduler python -c "
from agents.agent_4_conversation import BOOKING_PHRASES, BOOKING_AFFIRMATIONS, NEGATIVE_WORDS, _norm, _has_phrase, _BOOKING_AFFIRMATION_MAX_CHARS
sara_msg = 'Todo ok y perfecto, tomaré clases en una escuela presencial. Agradezco muchisimo tu tiempo.'
n = _norm(sara_msg)
neg = _has_phrase(n, NEGATIVE_WORDS['es'] + NEGATIVE_WORDS['de'])
bp = _has_phrase(n, BOOKING_PHRASES['es'])
ba = _has_phrase(n, BOOKING_AFFIRMATIONS['es']) if len(n) <= _BOOKING_AFFIRMATION_MAX_CHARS else None
print(f'  Sara msg: {sara_msg!r}')
print(f'  matched negative? {neg}')
print(f'  matched booking_phrases? {bp}')
print(f'  matched booking_affirmations (len-restricted)? {ba}')
print(f'  → Decision: {\\\"NEGATIVE\\\" if neg else (\\\"BOOKING\\\" if (bp or ba) else \\\"OTHER\\\")}')
"
""", label="3. Verificación in-container")

run("""
echo '── Estado de Sara post-pause ──'
docker exec aa_agents_scheduler python -c "
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute(\\\"SELECT name, status, ai_paused_until FROM leads WHERE name = 'Sara'\\\")
    r = cur.fetchone()
    print(f'  Sara: status={r[\\\"status\\\"]} paused_until={r[\\\"ai_paused_until\\\"]}')
"
""", label="4. Estado Sara")

client.close()
