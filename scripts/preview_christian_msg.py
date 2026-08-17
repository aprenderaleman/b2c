"""Previsualiza el mensaje que Christian recibiría AHORA si responde 'Ja'."""
import sys; sys.path.insert(0, "/app")
from agents.shared.db import get_conn
from agents.agent_4_conversation import _handle_trial_already_booked
from unittest.mock import patch, MagicMock

with get_conn() as conn, conn.cursor() as cur:
    cur.execute("SELECT * FROM leads WHERE name='Christian' AND email LIKE '%aleman05%'")
    lead = dict(cur.fetchone())
print(f"Lead: {lead['name']} (lang={lead['language']}, status={lead['status']})")

captured = {}
def fake_send(lead, body, **kw):
    captured["body"] = body
    return MagicMock(success=True)

with patch("agents.agent_4_conversation.send_approved", side_effect=fake_send):
    _handle_trial_already_booked(lead, "Ja", None)

print()
print("="*60)
print("MENSAJE QUE CHRISTIAN RECIBIRÍA AHORA:")
print("="*60)
print(captured["body"])
print("="*60)
