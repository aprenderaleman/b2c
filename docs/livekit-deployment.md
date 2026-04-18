# LiveKit + Coturn + Egress — Hetzner VPS deployment

This is the ops runbook for standing up the live-video stack that
Phase 3 of the LMS depends on. Everything below runs on the same
Hetzner VPS that currently hosts the agents (Coolify + Traefik).

## Overview

Three services, all Dockerised, behind Traefik:

| Service | Subdomain | Purpose |
|---|---|---|
| livekit-server | `livekit.aprender-aleman.de` | SFU for real-time video (WebSocket + WebRTC) |
| coturn         | `turn.aprender-aleman.de`    | TURN server — needed for users behind strict NAT (corporate networks, carrier CGNAT) |
| livekit-egress | (internal)                   | Records rooms and uploads to S3-compatible object storage |

Storage for recordings: **Hetzner Object Storage** (S3-compatible, EU
location for GDPR). Create a bucket named `aa-recordings` before
configuring egress.

## Prerequisites

- DNS records (both Hostinger control panel):
  - `livekit.aprender-aleman.de` → A record to your Hetzner VPS IPv4
  - `turn.aprender-aleman.de`    → A record, same IP
- Hetzner Object Storage bucket created; note the endpoint URL + access key + secret key
- On the Hetzner firewall: open TCP 443 (if not already) and the TURN/TURNS ports below

## Required ports

| Port  | Proto | Used by | Notes |
|---|---|---|---|
| 443   | TCP | livekit-server (wss://)  | Existing Traefik termination is fine |
| 7881  | TCP | livekit-server internal  | Don't expose publicly |
| 7882  | UDP | livekit-server fallback  | Open to the world |
| 3478  | UDP+TCP | coturn (TURN/STUN)   | Open to the world |
| 5349  | UDP+TCP | coturn (TURN over TLS) | Open to the world |
| 49152-65535 | UDP | coturn relay range | Open to the world |

## `docker-compose.yml` snippet

Add the following alongside the existing agents stack (or a separate
compose file — Coolify supports both):

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    restart: unless-stopped
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    networks: [coolify]
    labels:
      - traefik.enable=true
      - traefik.http.routers.livekit.rule=Host(`livekit.aprender-aleman.de`)
      - traefik.http.routers.livekit.entrypoints=websecure
      - traefik.http.routers.livekit.tls.certresolver=letsencrypt
      - traefik.http.services.livekit.loadbalancer.server.port=7880
    ports:
      - "7882:7882/udp"

  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host     # TURN needs direct UDP, bridge is lossy
    volumes:
      - ./coturn.conf:/etc/coturn/turnserver.conf:ro
      - /etc/letsencrypt/live/turn.aprender-aleman.de:/certs:ro
    command: -c /etc/coturn/turnserver.conf

  egress:
    image: livekit/egress:latest
    restart: unless-stopped
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress.yaml
    volumes:
      - ./egress.yaml:/etc/egress.yaml:ro
    networks: [coolify]
    depends_on: [livekit]

networks:
  coolify:
    external: true
```

## `livekit.yaml`

```yaml
port: 7880
bind_addresses:
  - ""
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true

keys:
  # Generate with: openssl rand -hex 32  (produces a 64-char hex string)
  APIxxxxxxxxxxx: SECRETxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

turn:
  enabled: true
  domain: turn.aprender-aleman.de
  tls_port: 5349
  udp_port: 3478

redis:
  address: redis:6379    # for egress pubsub — add a redis service if not present
```

## `coturn.conf`

```conf
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535

realm=turn.aprender-aleman.de
server-name=turn.aprender-aleman.de

# Use shared secret auth so LiveKit can mint time-limited TURN credentials
use-auth-secret
static-auth-secret=<SAME_VALUE_AS_turn.credential_secret_in_livekit.yaml>

cert=/certs/fullchain.pem
pkey=/certs/privkey.pem

no-tcp-relay
no-multicast-peers
syslog
fingerprint
```

Obtain Let's Encrypt certs for `turn.aprender-aleman.de` with certbot
**in standalone mode** (coturn needs the certs mounted, unlike the
Traefik setup).

## `egress.yaml`

```yaml
redis:
  address: redis:6379

api_key: APIxxxxxxxxxxx       # same as livekit.yaml
api_secret: SECRETxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ws_url: wss://livekit.aprender-aleman.de

s3:
  access_key:    <hetzner_object_storage_access_key>
  secret:        <hetzner_object_storage_secret>
  region:        eu-central
  endpoint:      https://<your-project>.<region>.objectstorage.hetzner.cloud
  bucket:        aa-recordings
  force_path_style: true
  # server-side encryption left default
```

## Env vars Vercel needs

After the VPS stack is up, set these on the Vercel project (Settings
→ Environment Variables → Production):

```
LIVEKIT_URL=wss://livekit.aprender-aleman.de
LIVEKIT_API_KEY=APIxxxxxxxxxxx
LIVEKIT_API_SECRET=SECRETxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Redeploy. The aula pages will now actually connect — no more
"Aula en preparación" screen.

## Smoke test

1. `curl -I https://livekit.aprender-aleman.de/` — should return 404 (no
   HTTP handler) but with valid TLS. Confirms Traefik is routing.
2. Agendar una clase para dentro de 20 min.
3. Entra como profesor, pulsa "Entrar al aula" — debería ver su cámara.
4. Entra como estudiante en otro navegador/ventana — deberían verse
   mutuamente.
5. Profesor pulsa Leave. Cierra el aula → bounce a `/profesor/clases/[id]?end=1`
   → modal pide confirmar duración.
6. Revisar la bucket `aa-recordings` en Hetzner — debería haber un mp4
   con el nombre del room.

## Recording webhook

LiveKit Egress fires `egress.updated` HTTP webhooks when a recording
finishes. Point it at:

```
POST https://b2c.aprender-aleman.de/api/webhooks/livekit-egress
```

This endpoint lands in a future commit — it'll insert/update the
`recordings` row (file_url, file_size_bytes, duration_seconds,
status='ready'). Add the webhook URL in livekit.yaml:

```yaml
webhooks:
  - url: https://b2c.aprender-aleman.de/api/webhooks/livekit-egress
    api_key: APIxxxxxxxxxxx
```

## Troubleshooting

- **"Could not connect"** in the aula client: open DevTools, check the
  WebSocket request to `/rtc` — if it 404s, Traefik isn't routing.
- **Video freezes after 30 s**: TURN isn't reachable. Verify
  `curl turn.aprender-aleman.de:3478 -v` opens. Most likely firewall.
- **Recording status stuck at "processing"**: check egress logs:
  `docker logs livekit-egress`. Usually an S3 creds / bucket CORS issue.
