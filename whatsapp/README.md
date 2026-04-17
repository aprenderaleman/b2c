# WhatsApp service (Evolution API v2)

## Fastest path — Hetzner VPS (recommended)

1. From Windows, upload the repo to the VPS (one time):
   ```bash
   scp -r "C:/Users/gelfi/Desktop/b2c" root@<VPS_IP>:/opt/
   ```

2. SSH in and run the installer:
   ```bash
   ssh root@<VPS_IP>
   export DOMAIN_EVOLUTION=evolution.aprender-aleman.de
   export DOMAIN_AGENTS=agents.aprender-aleman.de
   sudo -E bash /opt/b2c/scripts/deploy_vps.sh
   ```
   The script installs Docker, brings Evolution API up with automatic HTTPS
   via Caddy, creates the `aa` user, installs the Python env, and registers
   two systemd units: `aa-agents` (FastAPI) and `aa-scheduler` (Agent 0).

3. Point DNS A records for both subdomains at the VPS IP (one time).

4. Link WhatsApp — scan the QR once:
   ```bash
   sudo -u aa /opt/b2c/.venv/bin/python \
       /opt/b2c/agents/scripts/bootstrap_whatsapp.py
   ```
   The script prints a short URL with the QR. Open it from any browser,
   scan with WhatsApp on +4915253409644 → Settings → Linked devices.

5. Fill `/opt/b2c/.env` with Supabase + Anthropic + Calendly credentials,
   then:
   ```bash
   systemctl start aa-agents aa-scheduler
   ```

That's it. From this point the agents keep running 24/7 and auto-restart
on reboot. Log check:  `journalctl -u aa-agents -f`.

---

## Optional — local development

Requires **Docker Desktop** running on Windows.

```bash
# From repo root:
bash scripts/start_local.sh
```

The script:
1. Creates `whatsapp/.env` with auto-generated API key + DB password.
2. Syncs the same key into root `.env`.
3. Runs `docker compose up -d` in `whatsapp/`.
4. Waits for Evolution API to be healthy.
5. Runs `agents/scripts/bootstrap_whatsapp.py` — opens the QR in your
   default browser.

Subsequent restarts: just `docker compose up -d` from `whatsapp/`.

---

## Monitoring the Evolution UI

Evolution API exposes a manager at:
- Local:      http://localhost:8080/manager
- Production: https://evolution.aprender-aleman.de/manager

Log in with the API key stored in `whatsapp/.env` (`EVOLUTION_API_KEY`).

## Number rotation (two-numbers safeguard)

The schema supports a main + backup WhatsApp number (spec requirement).
The `system_config` table stores:
- `active_whatsapp_instance`  — currently "aprender-aleman-main"
- `active_whatsapp_number`    — currently "+4915253409644"
- `backup_whatsapp_number`    — empty for now

When the backup number is added, rerun `bootstrap_whatsapp.py` with
`EVOLUTION_INSTANCE_MAIN=aprender-aleman-backup` to create that instance.
Agent 3 will send via whichever instance is active; a single UPDATE to
`system_config` swaps the active one instantly.

## Webhook events Evolution posts to us

The webhook receiver at `/webhook/whatsapp` handles:

| Event              | Handler in Agent 4 |
|--------------------|--------------------|
| `messages.upsert`  | inbound message → keyword scan → maybe AI reply |
| `messages.update`  | read receipts → update `last_message_seen_at` |
| `connection.update`| connection drops → notify Gelfis |
| `qrcode.updated`   | QR regenerated → log |
