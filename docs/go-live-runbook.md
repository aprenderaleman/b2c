# Runbook de puesta en producción — LMS completo

Todo el código está desplegado. Este documento lista sólo los pasos
**manuales** que no podía hacer yo (requieren tu login en servicios
externos o tu acceso al VPS).

## Estado actual

- ✅ **Base de datos**: las 17 migraciones (`004` → `020`) están
  aplicadas en Supabase. Gelfis está seeded como `superadmin`.
  Buckets `chat-uploads` (10 MB) y `materials` (50 MB) creados.
- ✅ **Vercel env vars**: `PLATFORM_URL`, `HANS_URL`, `SCHULE_URL`,
  `EMAIL_FROM`, `DIGEST_RECIPIENT`, `CRON_SECRET` ya configurados.
- ✅ **Redeploy**: disparado (`dpl_HdamcEsZiihucD1FoYDr7un8Bk94`).
- ✅ **Vercel Cron**: los dos jobs (`class-reminders` cada 10 min +
  `daily-digest` 17:00 UTC) se activarán con este deploy.

## Lo que aún falta (≈ 30 min total)

### 1. DNS subdominio `live.aprender-aleman.de` (5 min)

En **Vercel** → Project `b2c` → **Settings → Domains**:
1. *Add domain* → escribe `live.aprender-aleman.de` → siguiente.
2. Vercel te dará un CNAME (suele ser `cname.vercel-dns.com`).
3. En **Hostinger** → DNS de `aprender-aleman.de`:
   - *Add record*: Type `CNAME`, Name `live`, Value `cname.vercel-dns.com`,
     TTL `300`.
4. Espera 1-3 min y Vercel validará automáticamente.

### 2. Resend — emails de bienvenida, reset, digest (10 min)

Sin esto el código corre pero los emails sólo se loguean en stdout
(la conversión crea al estudiante igual; solo que el estudiante
no recibe el correo con password).

1. Crea cuenta en https://resend.com con `info@aprender-aleman.de`.
2. *Domains* → *Add Domain* → `aprender-aleman.de`.
3. Resend te dará 3 registros DNS (SPF TXT + 2 DKIM CNAME). Pégalos
   en Hostinger.
4. Tras ~5 min Resend marca el dominio como verificado.
5. Copia la API key (`re_...`) → en **Vercel Settings → Env vars**:
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
   ```
6. Redeploy automático se dispara al guardar la env var.

### 3. VPS — activar `/internal/send-text` (5 min)

Sin esto: la conversión lead → student crea al estudiante y envía
el email, pero **no** el WhatsApp welcome.

```bash
ssh root@<VPS-IP>
cd /opt/b2c        # o donde esté el repo
git pull

# Añade en .env.prod:
#   AGENTS_INTERNAL_SECRET=<valor-largo>
# Mismo valor lo pondrás en Vercel como AGENTS_INTERNAL_SECRET.
nano .env.prod

docker compose restart agents
```

En **Vercel Settings → Env vars**:
```
AGENTS_BASE_URL=https://agents.aprender-aleman.de
AGENTS_INTERNAL_SECRET=<mismo-valor-que-VPS>
```

### 4. LiveKit stack (Phase 3 — cuando quieras activar aula en vivo)

Sigue `docs/livekit-deployment.md` (DNS + docker-compose + Let's
Encrypt + Hetzner Object Storage). Luego en Vercel:
```
LIVEKIT_URL=wss://livekit.aprender-aleman.de
LIVEKIT_API_KEY=<del livekit.yaml>
LIVEKIT_API_SECRET=<del livekit.yaml>
```

Mientras no lo actives, `/aula/[id]` muestra "Aula en preparación"
y el resto del sistema funciona perfectamente.

### 5. Opcional — extender Calendly al nuevo flujo

El webhook de Calendly ya captura el email del lead y lo mete en
`leads.email`. Si quieres que Calendly redireccione tras booking
a `/clase-agendada` (página bonita post-reserva), ve a:
- Calendly → Event Type → *Confirmation page* → *Redirect*
- URL: `https://aprender-aleman.de/clase-agendada`

---

## Verificación rápida post-deploy

```bash
# DNS
curl -sS -o /dev/null -w "%{http_code}\n" https://live.aprender-aleman.de/login
# → debería ser 200 (o 307 si redirige según rol)

# Cron (manual test)
curl -X POST https://live.aprender-aleman.de/api/cron/class-reminders \
  -H "X-Cron-Secret: $(sb-env CRON_SECRET)"

# Health del chat
curl -sS -o /dev/null -w "%{http_code}\n" https://live.aprender-aleman.de/chat
# → 307 redirect a /login si no estás autenticado (correcto)
```

Para probar el flujo completo:

1. `/login` con el email de Gelfis + tu password actual.
2. `/admin/profesores/nuevo` — crea un profesor de prueba.
3. Entra en incógnito con las credenciales del profe (llegarán por
   email si Resend está activo, o las verás en la respuesta JSON si
   el email falla).
4. `/admin/leads/<uno-existente>` → "Convertir en estudiante".
5. `/admin/clases` → "Agendar clase" con ese profe y estudiante.
6. Espera 15 min antes de la clase → "Entrar al aula" funciona (si
   LiveKit está activo).

---

## Resumen de todo el sistema

- **30 tablas** en Supabase (Phase 0-6 completas)
- **60 rutas** en Next.js (admin + profesor + estudiante + público)
- **2 crons** Vercel (class-reminders 10 min, daily-digest 17:00 UTC)
- **2 buckets** Supabase Storage (chat-uploads, materials)
- **Autenticación**: NextAuth Credentials + tabla `users` con roles
  (superadmin/admin/teacher/student) + password reset + temp passwords
- **Emails** (Resend pendiente): welcome-student, welcome-staff,
  password-reset, daily-digest
- **Notificaciones**: in-app bell + WhatsApp (vía agente VPS)
- **Cert PDFs** generados on-the-fly con PDFKit
- **Chat** real con polling 4s, attachments via Supabase Storage
- **Finanzas** sin Stripe (pagos manuales + payroll mensual)
- **Reportes** (asistencia + risk alerts) + integración en admin
  "Hoy" + daily digest
