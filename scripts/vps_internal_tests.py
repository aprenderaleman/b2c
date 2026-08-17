"""4 pruebas internas end-to-end tras los fixes."""
import io, os, sys, json, paramiko
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOST = os.environ["VPS_HOST"]; USER = os.environ["VPS_USER"]; PASS = os.environ["VPS_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd, label=""):
    print(f"\n══════════ {label} ══════════")
    _, stdout, _ = client.exec_command(cmd, timeout=60, get_pty=True)
    for line in iter(stdout.readline, ""):
        if not line: break
        print(line, end="", flush=True)

# ─── Test 1: outbound real ─────────────────────────────────────────────────
run("""
SECRET=$(grep ^AGENTS_INTERNAL_SECRET= /opt/b2c/.env | cut -d= -f2)
GELFIS=$(grep ^GELFIS_PERSONAL_WHATSAPP= /opt/b2c/.env | cut -d= -f2)
echo "Enviando a $GELFIS..."
curl -s -w '\\nhttp %{http_code}\\n' \\
  -H "X-Internal-Secret: $SECRET" \\
  -H "Content-Type: application/json" \\
  -d "{\\"phone\\":\\"$GELFIS\\",\\"text\\":\\"🧪 Test interno post-recovery — $(date +%H:%M:%S). Si recibes esto, el pipeline outbound de Vercel→agents→Evolution→WhatsApp funciona.\\",\\"kind\\":\\"internal_test\\"}" \\
  https://agents.aprender-aleman.de/internal/send-text
""", label="Test 1: outbound /internal/send-text → Gelfis WhatsApp")

# ─── Test 2: disparar _notify_trials_30min manualmente dentro del container ──
run("""
docker exec aa_agents_scheduler python -c "
from agents.scheduler import _notify_trials_30min
print('Calling _notify_trials_30min()...')
_notify_trials_30min()
print('OK — sin excepción, el SQL se ejecutó correctamente.')
" 2>&1
""", label="Test 2: _notify_trials_30min sin crash (Bug 2 fix)")

# ─── Test 3: simular un POST de Evolution con número desconocido ─────────
run("""
SECRET=$(grep ^EVOLUTION_WEBHOOK_SECRET= /opt/b2c/.env | cut -d= -f2)
echo "Enviando webhook synthetic con phone +1555TEST (no matchea ningún lead)..."
PAYLOAD='{
  "event": "messages.upsert",
  "data": {
    "key": {
      "remoteJid": "1555TESTNUMBER@s.whatsapp.net",
      "fromMe": false
    },
    "pushName": "Test Synthetic",
    "message": {"conversation": "test inbound webhook"},
    "sender": "1555TESTNUMBER"
  }
}'
HEADERS=(-H "Content-Type: application/json")
[ -n "$SECRET" ] && HEADERS+=(-H "X-Webhook-Secret: $SECRET")
curl -s -w '\\nhttp %{http_code}\\n' "${HEADERS[@]}" -d "$PAYLOAD" https://agents.aprender-aleman.de/webhook/whatsapp
echo
echo '── log del webhook procesando el payload ──'
sleep 2
docker logs aa_agents_webhook --tail 15 2>&1 | grep -E 'webhook|unmatched|WA msg' | tail -8
""", label="Test 3: POST synthetic /webhook/whatsapp (phone desconocido → 200)")

# ─── Test 4: ¿llegó algo real desde que arreglamos? ──────────────────────
run("""
echo '── últimos eventos lead_timeline tipo lead_message_received ──'
psql -h db.cwmyfubptdvigzdoyydq.supabase.co -U postgres.cwmyfubptdvigzdoyydq -d postgres -c \"
  SELECT timestamp AT TIME ZONE 'Europe/Berlin' AS local_time, lead_id, content
    FROM lead_timeline
   WHERE type='lead_message_received'
     AND timestamp > NOW() - INTERVAL '1 hour'
   ORDER BY timestamp DESC LIMIT 10;
\" 2>&1 || echo '(psql no disponible en VPS — chequea desde local)'
""", label="Test 4: ¿inbound real en última hora?")

client.close()
