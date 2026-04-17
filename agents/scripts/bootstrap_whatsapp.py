"""
One-shot bootstrap for the WhatsApp instance.

What it does:
  1. Connects to Evolution API (via EVOLUTION_API_URL + EVOLUTION_API_KEY).
  2. Creates the main instance if it doesn't exist.
  3. Configures the webhook to point at the agents service.
  4. If not yet connected, opens the QR in your default browser so you
     can scan it with WhatsApp on your phone.
  5. Waits until the connection is 'open' or 3 minutes pass.

Usage:
    python agents/scripts/bootstrap_whatsapp.py

Reads from .env:
    EVOLUTION_API_URL
    EVOLUTION_API_KEY
    EVOLUTION_INSTANCE_MAIN    (default: aprender-aleman-main)
    AGENTS_WEBHOOK_URL         (default: http://host.docker.internal:8000/webhook/whatsapp)
"""
from __future__ import annotations

import os
import sys
import tempfile
import webbrowser
from base64 import b64decode
from pathlib import Path

from dotenv import load_dotenv

# Allow running as `python agents/scripts/bootstrap_whatsapp.py`
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.whatsapp_service import WhatsAppError, WhatsAppService  # noqa: E402


def main() -> int:
    load_dotenv()
    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    webhook = os.environ.get(
        "AGENTS_WEBHOOK_URL", "http://host.docker.internal:8000/webhook/whatsapp"
    )

    try:
        wa = WhatsAppService()
    except WhatsAppError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("Did you run: cp whatsapp/.env.example whatsapp/.env and set EVOLUTION_API_KEY?", file=sys.stderr)
        print("Also copy that key into your root .env as EVOLUTION_API_KEY.", file=sys.stderr)
        return 1

    print(f"Instance:       {instance}")
    print(f"Webhook target: {webhook}")
    print(f"Evolution URL:  {wa.config.base_url}")
    print()

    # Step 1: create if needed
    existed = wa.instance_exists(instance)
    if not existed:
        print("→ Creating instance…")
        wa.create_instance(instance, webhook_url=webhook)
    else:
        print("→ Instance already exists.")
        try:
            wa.set_webhook(instance, webhook)
            print("  webhook updated.")
        except WhatsAppError as e:
            print(f"  (could not update webhook: {e})")

    # Step 2: check connection state
    state = wa.get_connection_state(instance)
    print(f"→ State: {state}")
    if state == "open":
        print("\n✓ Already connected. Nothing else to do.")
        return 0

    # Step 3: fetch QR and open in browser
    print("→ Fetching QR code…")
    qr = wa.get_qr_base64(instance)
    if not qr:
        print("ERROR: No QR returned. Try restarting the Evolution container.", file=sys.stderr)
        return 2

    qr_payload = qr.split(",", 1)[1] if qr.startswith("data:") else qr
    try:
        png_bytes = b64decode(qr_payload)
    except Exception as e:
        print(f"ERROR: Could not decode QR: {e}", file=sys.stderr)
        return 3

    out = Path(tempfile.gettempdir()) / "aa_whatsapp_qr.png"
    out.write_bytes(png_bytes)
    print(f"→ QR saved to {out}")

    html = Path(tempfile.gettempdir()) / "aa_whatsapp_qr.html"
    html.write_text(
        f"""<!doctype html>
<html><head><meta charset=utf-8><title>Escanea con WhatsApp</title>
<style>
  body {{ font-family: system-ui, sans-serif; display: flex; align-items: center;
          justify-content: center; min-height: 100vh; margin: 0;
          background: linear-gradient(135deg,#FFF7ED,#FED7AA); }}
  .box  {{ text-align: center; background: white; padding: 2rem 3rem;
          border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.1); }}
  img   {{ width: 320px; height: 320px; }}
  h1    {{ color: #F97316; }}
  p     {{ color: #475569; max-width: 360px; }}
</style></head><body>
<div class=box>
  <h1>Escanea con WhatsApp</h1>
  <p>WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo</p>
  <img src="file:///{out.as_posix()}" alt="QR">
  <p><small>El QR se actualiza cada 30 segundos. Si expira, vuelve a correr este script.</small></p>
</div>
</body></html>""",
        encoding="utf-8",
    )
    print(f"→ Opening QR in browser…")
    webbrowser.open(html.as_uri())

    # Step 4: wait for connection
    print("→ Waiting for scan (up to 3 minutes)…")
    final = wa.wait_for_connection(instance, timeout_seconds=180)
    if final == "open":
        print("\n✓ Connected! You're good to go.")
        return 0
    print(f"\n✗ Did not connect (final state: {final}). Re-run this script to try again.")
    return 4


if __name__ == "__main__":
    sys.exit(main())
