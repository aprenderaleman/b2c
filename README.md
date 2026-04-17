# Aprender-Aleman.de — B2C System

Complete lead capture, nurturing and conversion pipeline for
Aprender-Aleman.de (German academy for Spanish speakers).

## System map

```
┌──────────────────────────────────┐   ┌────────────────────────────────┐
│  web/ (Next.js 15 — Vercel)      │   │  agents/ (Python 3.11 — VPS)   │
│  ├─ /         homepage           │   │  ┌─ scheduler.py               │
│  ├─ /funnel   5-step signup      │   │  │   Agent 0 every 15 min      │
│  ├─ /confirmacion                │   │  │   Trial reminders 08:00     │
│  ├─ /privacy  GDPR policy        │   │  │   Escalation sweep 5 min    │
│  ├─ /admin/login                 │   │  │   Absent-followup hourly    │
│  ├─ /admin    Today view         │   │  │   Daily summary 19:00       │
│  ├─ /admin/leads                 │   │  │                             │
│  ├─ /admin/leads/[id]            │   │  ├─ webhook_server.py (FastAPI)│
│  │                               │   │  │   /webhook/calendly         │
│  └─ /api/leads  (lead create)    │   │  │   /webhook/whatsapp         │
│     /api/admin/leads/[id]/*      │   │  │   /healthz                  │
│       convert / lost / reactivate│   │  │                             │
│       trial/attended / absent    │   │  └─ 6 agents                   │
│       notes / export / delete    │   │     0 watcher  1 writer        │
│     /api/auth/[...nextauth]      │   │     2 reviewer 3 sender        │
└─────────────┬────────────────────┘   │     4 convers. 5 guardian      │
              │                        └──────────────┬─────────────────┘
              ▼                                       ▼
     ┌───────────────────────────────────────────────────────┐
     │  Supabase Postgres                                    │
     │    leads · lead_timeline · gelfis_notes ·             │
     │    system_config · response_cache · message_send_log· │
     │    agent_run_log · gelfis_notifications ·             │
     │    lead_deletion_log                                  │
     └───────────────────────────────────────────────────────┘
                                 ▲
                                 │
                 ┌───────────────┴────────────────┐
                 │  Evolution API v2 (Docker, VPS)│
                 │   main:   aprender-aleman-main │
                 │   backup: aprender-aleman-backup (for rotation) │
                 │   Caddy reverse-proxy → HTTPS  │
                 └────────────────────────────────┘
```

## Repo layout

```
b2c/
├── db/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── 002_gdpr.sql
│   └── run_migrations.py
├── agents/
│   ├── shared/           phone.py · db.py · rate_limits.py · leads.py · claude_client.py
│   ├── agent_0_watcher.py       (pure code — scheduler)
│   ├── agent_1_writer.py        (templates + Sonnet for re-engagement)
│   ├── agent_2_reviewer.py      (Haiku batch, 5 drafts per call)
│   ├── agent_3_sender.py        (Evolution API, rate-limit enforcement)
│   ├── agent_4_conversation.py  (keyword layer + Sonnet fallback)
│   ├── agent_5_guardian.py      (Calendly + conversion state machine)
│   ├── notifications.py         (Gelfis WhatsApp pings)
│   ├── scheduler.py             (APScheduler — one process, every job)
│   ├── webhook_server.py        (FastAPI — Calendly + WhatsApp webhooks)
│   ├── whatsapp_service.py      (Evolution API client)
│   ├── scripts/bootstrap_whatsapp.py
│   ├── tests/test_smoke.py      (45 assertions, no external calls)
│   └── requirements.txt
├── web/                 Next.js 15 + Tailwind + NextAuth v5
│   ├── app/             (App Router: funnel, confirmacion, privacy, admin)
│   ├── components/      (Funnel, Header, admin/*)
│   ├── lib/             (phone.ts, i18n.ts, auth.ts, supabase.ts, dashboard.ts)
│   └── package.json
├── whatsapp/
│   ├── docker-compose.yml       Evolution API + Postgres + Redis + Caddy
│   ├── Caddyfile
│   └── README.md                VPS + local setup
├── scripts/
│   ├── start_local.sh           One-shot local bootstrap
│   └── deploy_vps.sh            One-shot VPS install
├── .env.example
└── README.md
```

## Deploy in four commands

### 1. Database

```bash
cp .env.example .env             # fill in Supabase + Anthropic + Calendly
cd agents && python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
cd .. && python db/run_migrations.py
```

### 2. Funnel + dashboard (Vercel)

```bash
cd web
npm install
# Generate admin password hash once:
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'YOUR_PASSWORD'
# Put it in Vercel env as ADMIN_PASSWORD_HASH, plus SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# NEXTAUTH_SECRET, NEXTAUTH_URL, ADMIN_EMAIL
#
# ⚠️ On Vercel you paste the hash raw — the UI doesn't do $-expansion.
#    But in a local .env.local file, Next.js expands $VAR so you MUST
#    escape each $ as \$ in the bcrypt hash, e.g.
#      ADMIN_PASSWORD_HASH=\$2a\$12\$u5qC/TbSf...
vercel --prod
```

### 3. VPS (Evolution + agents)

```bash
scp -r b2c root@<VPS_IP>:/opt/
ssh root@<VPS_IP>
export DOMAIN_EVOLUTION=evolution.aprender-aleman.de
export DOMAIN_AGENTS=agents.aprender-aleman.de
sudo -E bash /opt/b2c/scripts/deploy_vps.sh
```

### 4. Link WhatsApp (one time)

```bash
sudo -u aa /opt/b2c/.venv/bin/python /opt/b2c/agents/scripts/bootstrap_whatsapp.py
# Opens a browser URL with the QR. Scan with +4915253409644.
systemctl start aa-agents aa-scheduler
```

## Configure Calendly webhook

1. In Calendly (Integrations → Webhooks), add:
   - URL: `https://agents.aprender-aleman.de/webhook/calendly`
   - Events: `invitee.created`, `invitee.canceled`
   - Save the signing key into `.env` as `CALENDLY_WEBHOOK_SIGNING_KEY`
2. Ensure the event form has **required** fields: name, email, and a
   phone question (labeled "WhatsApp" or similar — the webhook picks it
   up via keyword match in the question text).

## Credit-cost engineering

| Mechanism                              | Typical savings |
|----------------------------------------|-----------------|
| Contacts 1 & 2 as templates            | ~40 % of sends  |
| Agent 4 keyword layer                  | ~60 % of replies|
| Agent 2 batches up to 5 drafts / call  | ~70 % of reviews|
| Response cache (24 h TTL)              | Common Qs free after 1st |
| Prompt caching on BRAND_CONTEXT system | ~90 % on cache hits |
| Conversation context limited to 5 msgs | Input tokens capped |

## Regulatory / ban protections

- **GDPR**: mandatory consent checkbox (enforced server-side), privacy
  page, data export endpoint (`/api/admin/leads/{id}/export`), erasure
  endpoint (`/api/admin/leads/{id}/delete` → `gdpr_delete_lead()`
  Postgres function + `lead_deletion_log` audit).
- **WhatsApp ban protection**: max 40 new convos/day, max 10/hour,
  randomized 30–90 s delays, blackout 22:00–08:00 Europe/Berlin, no
  Sundays, cold-after-3-unseen. All enforced from DB so limits survive
  restarts. Architecture supports a backup number (`active_whatsapp_instance`
  config row toggles the active one instantly).

## Verifying the system

```bash
# Python smoke suite (no external calls, ~1 s):
python -m agents.tests.test_smoke
#   ✓ All 45 smoke tests passed.

# TypeScript typecheck:
cd web && npm run typecheck
```

## The 6 agents at a glance

| Agent | Type | Trigger | Model |
|-------|------|---------|-------|
| 0 Watcher | pure code | cron every 15 min (08–19 Berlin) | — |
| 1 Writer | templates + AI | called by Agent 0 / Agent 4 | Haiku / Sonnet |
| 2 Reviewer | AI batch | after Agent 1 (AI drafts only) | Haiku |
| 3 Sender | pure code | after Agent 2 approves | — |
| 4 Conversation | keyword + AI | WhatsApp webhook | — / Sonnet |
| 5 Guardian | event-driven | Calendly webhook / dashboard state | — |

Templates auto-approve in Agent 2 (no credit cost). Only AI-written
drafts (contact 3+, conversation replies) go through the batch LLM
reviewer.

## License

Private, © Gelfis Horn / Aprender-Aleman.de.
