# Capa Funnels · Captación de Leads · Ads

**Documento maestro — sección técnica.**
Autor: capa funnels (Gelfis Horn, con asistencia de Claude Code).
Última revisión: 2026-07-28.

Este documento cubre **la capa entre el click en un anuncio y la existencia del lead en el CRM con su cita de trial + eventos de tracking disparados**. Cualquier cosa antes (web pública corporativa) o después (CRM operativo, LMS, pagos post-trial, aula de vídeo) se documenta en sus respectivos anexos.

## Fronteras explícitas

| Capa | Responsable | Documento |
|---|---|---|
| Web pública corporativa (`aprender-aleman.de`) | Otro dev/agencia | *Anexo web corporativa* (no aquí) |
| **Funnels · captación · ads · tracking** (`b2c.aprender-aleman.de`) | **Este doc** | **Este doc** |
| CRM operativo (leads, timeline, ficha del lead) | Otro dev | *Anexo CRM/LMS* |
| LMS (SCHULE, alumnos, materiales, grabaciones) | Otro dev | *Anexo CRM/LMS* |
| Aula de vídeo (LiveKit) | Otro dev | *Anexo Aula* |
| Mensajería (WhatsApp Evolution + email Resend) | Otro dev | *Anexo Mensajería* |

**Contacto entre capas**:
- Escribimos en la tabla `leads` y `classes` para pasar el testigo al CRM.
- Escribimos `classes.notify_after_at` para que el cron de mensajería sepa cuándo enviar la confirmación.
- Escribimos `lead_timeline` para audit; el CRM lo lee.
- El aula de vídeo lee `classes` cuando el lead entra por el magic-link.

Todo el código de esta capa vive en el repo `b2c` bajo `web/`. Deploy: Vercel → dominio `b2c.aprender-aleman.de` (frontend + Next.js API routes). Base de datos: Supabase Postgres compartida con el resto de capas.

---

## 1. Inventario de funnels

Todas las landings viven en `web/app/**/page.tsx` (Next.js App Router) y renderizan el componente compartido `LandingStep0` (`web/components/landings/LandingStep0.tsx`), excepto donde se indica.

| Ruta pública | Propósito | `landing_intent` emitido | `noindex` | CTA destino | Notas |
|---|---|---|---|---|---|
| `/` | Home / redes sociales | `socialmedia` | no | `/agendar/cuando` | Preset de motivo |
| `/facebook` | Tráfico orgánico FB (bio, posts) | `facebook` | sí | `/agendar/cuando` | Badge 📘 |
| `/instagram` | Orgánico IG (bio, stories) | `instagram` | sí | `/agendar/cuando` | 📸 |
| `/tiktok` | Orgánico TikTok (bio link) | `tiktok` | sí | `/agendar/cuando` | 🎵 |
| `/youtube` | Orgánico YouTube (descripciones) | `youtube` | sí | `/agendar/cuando` | 📺 |
| `/meta-ads` | **Meta Ads pagado** (control A/B) | `meta-ads` | sí | `/agendar/cuando` | Copy dolor→solución + prueba social |
| `/meta-ads-paid` | **Meta Ads pagado + depósito 10€** (test A/B) | `meta-ads-paid` | sí | `/meta-ads-paid/funnel` | Wizard 5 pasos + Stripe |
| `/curso-aleman-online` | SEO/Google Ads | `curso-online` | no (SEO) | `/agendar/cuando` | |
| `/clases-particulares-aleman-online` | SEO/Google Ads | `particulares` | no | `/agendar/cuando` | |
| `/curso-intensivo-aleman` | SEO/Google Ads | `intensivo` | no | `/agendar/cuando` | |
| `/curso-aleman-certificado` | SEO/Google Ads | `certificado` | no | `/agendar/cuando` | |
| `/aleman-b2-trabajar` | SEO/Google Ads B2 profesional | `b2-trabajar` | no | `/agendar/cuando` | |
| `/clases-aleman-ciudades` | SEO por ciudades | `ciudades` | no | `/agendar/cuando` | |
| `/landing-anterior` | Backup del layout previo | (varía) | sí | `/agendar/cuando` | Solo si algo se rompe |

**Flujo de agendamiento común** (usado por 12 de 13 landings): `LandingStep0` → click CTA → `/agendar/cuando` (día/hora + datos) → `POST /api/public/book-trial` → redirige a `/confirmacion?c={classId}&t={token}`.

**Flujo alternativo `/meta-ads-paid`** (2026-07-28, A/B en marcha):
`/meta-ads-paid` → click CTA → `/meta-ads-paid/funnel` (wizard de 5 pasos: meta / nivel / plazo / calendario / datos) → `POST /api/public/book-trial-metaads-paid` (wrapper del `book-trial` estándar) → redirige a Stripe Checkout (10€) → success vuelve a `/confirmacion?...&deposito=ok`.

**Rutas que NO son landings de captación** (no meterlas en el conteo del funnel):
`/privacy`, `/registro-profesor`, `/closer`, `/estudiante/*`, `/profesor/*`, `/admin/*`, `/aula/*`, `/materiales/*`, `/schule`, `/hans`.

---

## 2. El viaje del lead — paso a paso

Desde el click en el anuncio hasta el lead en el CRM con cita agendada + tracking disparado.

### 2.1 Aterrizaje

1. Usuario aterriza en, p. ej., `/meta-ads?fbclid=IwARxx&utm_source=fb&utm_campaign=camp_es_1`.
2. `LandingStep0.useEffect`:
   - `captureAttributionFromUrl()` (`web/lib/ads-attribution.ts`) lee `?fbclid, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content` y los guarda en `sessionStorage` bajo keys `b2c.attr.*`. First-touch preservado dentro de la sesión.
   - `trackFunnel("landing_view", { landingIntent })` (`web/lib/track-funnel.ts`) inserta una fila en `funnel_progress`.
3. Meta Pixel (inyectado en `web/app/layout.tsx` vía `PixelTags.tsx`) ejecuta `fbq('init', PIXEL_ID)` + `fbq('track', 'PageView')`. Meta escribe el cookie `_fbc` (fmt `fb.1.<ts>.<fbclid>`) 1st-party sobre `b2c.aprender-aleman.de`.
4. Google Ads gtag (también en layout) ejecuta `gtag('config', 'AW-17724667323', { allow_enhanced_conversions: true })`. TikTok Pixel idem si `NEXT_PUBLIC_TIKTOK_PIXEL_ID` está seteado.

### 2.2 Click al CTA

- `trackFunnel("cta_click", { landingIntent })` → `funnel_progress` (step code 11).
- Link a `/agendar/cuando?landing=<slug>&motivo=<preset>` (o al wizard `/meta-ads-paid/funnel` para el paid).

### 2.3 Elección de horario (funnel estándar)

`/agendar/cuando/page.tsx` (client component):
1. Detecta timezone del navegador.
2. `GET /api/public/trial-slots` → lista de huecos disponibles calculados server-side desde la disponibilidad de profesores.
3. Renderiza `MobileDayStrip` + `TimeList` (componentes reutilizables en `web/components/agendar/`).
4. Al elegir slot: `trackFunnel("slot_picked", { answer: startIso })`.
5. Formulario inline (nombre, email, WhatsApp con selector de país vía `web/lib/phone.ts`).
6. Cada campo válido dispara `field_typed`, `phone_valid`, `commitment_checked` (nuevos steps 4/15/16).

### 2.4 Wizard de calificación (`/meta-ads-paid` únicamente)

`web/app/meta-ads-paid/funnel/PaidFunnelWizard.tsx` — 5 pasos:
1. **Meta** (goal): `job | ausbildung | citizenship | daily_life | moving`.
2. **Nivel**: `zero | basic | intermediate | advanced | unknown`.
3. **Plazo**: `concrete | 6m | year | no_rush` (el valor `concrete` marca al lead como 🔥 urgente en el CRM).
4. **Calendario**: mismo `MobileDayStrip + TimeList` reutilizados del funnel estándar.
5. **Datos**: form con `autoComplete` correcto (`given-name`, `email`, `tel-country-code`, `tel-national`) + validación E.164 (`lib/phone.ts`).

### 2.5 Reserva (POST → BD)

- Funnel estándar: `POST /api/public/book-trial`.
- Funnel paid: `POST /api/public/book-trial-metaads-paid` (que a su vez llama internamente al endpoint estándar para reutilizar toda la lógica de reserva, y luego añade su capa).

**Qué hace `book-trial`** (`web/app/api/public/book-trial/route.ts`):
1. **Rate limit**: 5 reservas/hora/IP (env `BOOK_TRIAL_RATE_LIMIT_MAX`). Tabla `rate_limit_log`.
2. **Rechaza usuarios ya registrados** (`users.email`) — para prevenir que un alumno pagante intente agendar trial de nuevo.
3. **Re-valida el slot** (evita race conditions).
4. **Lead upsert**: match por `email OR whatsapp_normalized` (índice único). Si existe:
   - Preserva ad attribution existente (**first-touch wins** en `gclid/gbraid/wbraid/utm_*` — no sobrescribimos si el lead ya tenía valor).
   - Sobrescribe `status='trial_scheduled'`, `trial_scheduled_at`, `source='funnel_trial_self_book'`, y los datos personales (`name`, `whatsapp`, `email`) solo si estaban vacíos.
   - Actualiza `landing_intent` con el nuevo valor.
   - `motivo_inicial` derivado del body o `'direct'` si no viene.
   Si NO existe: INSERT normal.
5. **Class insert**: fila en `classes` con `is_trial=true`, `duration_minutes=30`, `short_code` (8-char base36 para magic-link), `notify_after_at=NOW()`, `notified_at=NULL`.
6. **Anti-double-booking / auto-reschedule**: si el lead ya tenía una trial futura, la re-usa o la cambia de slot con patch a Google Calendar + rollback si el patch falla.
7. **`after()` (background tasks)**: crea el evento en el Google Calendar del profe, notifica por email al equipo (`NEW_LEAD_ALERT_EMAIL`), y crea el Zoom link para el aula.
8. Devuelve `{ ok, classId, leadId, token, teacherName, startDate, magicLinkUrl }`.

**Qué añade `book-trial-metaads-paid`** encima:
- Persiste `qualification_answers` (JSONB con las respuestas de los 3 pasos), `priority_deadline`, `deposit_intent_at=NOW`, `source='meta_ads_paid_funnel'`, `fbclid`.
- **Retrasa la confirmación**: `classes.notify_after_at = NOW + 13min` — para que el cron de mensajería no envíe email/WA mientras el lead está pagando en Stripe.
- Crea una **Stripe Checkout Session** (cuenta US) con `metadata.type='trial_deposit_metaads'` y devuelve la URL para redirigir al lead.

### 2.6 Confirmación

- Funnel estándar: redirect a `/confirmacion?c={classId}&t={token}`.
- Funnel paid: redirect a Stripe → success vuelve a `/confirmacion?c={classId}&t={token}&deposito=ok`.

En `/confirmacion` (`web/app/confirmacion/page.tsx`):
1. Se disparan los eventos de tracking client-side (ver §3.4).
2. Se muestra el resumen de la cita (fecha, profe, duración).
3. Si no pagó y viene del funnel paid: se muestra el CTA "🌟 Mejora a Reserva Prioritaria VIP" para hacer upsell del depósito.
4. Si ya pagó: banner grande dorado "¡Prioridad activada!".

### 2.7 Fuentes y cómo se distingue el origen

Cada lead termina con estos campos que permiten atribuir origen:

| Campo | Origen | Ejemplos |
|---|---|---|
| `leads.source` | Set por el endpoint que crea el lead | `funnel_trial_self_book`, `meta_ads_paid_funnel`, `stiv_conversation` (viene de Python) |
| `leads.landing_intent` | Set por el CTA de la landing | `meta-ads`, `meta-ads-paid`, `facebook`, `curso-online`, `direct`… |
| `leads.motivo_inicial` | Set por el quiz "¿Para qué?" o `'direct'` si vino de atajo | `particulares`, `intensivo`, `certificado`… |
| `leads.gclid / gbraid / wbraid` | URL de Google Ads (first-touch) | Habilita la conversión offline back a Google |
| `leads.fbclid` | URL de Meta Ads (backup) | Fallback si el cookie `_fbc` se pierde |
| `leads.utm_source / medium / campaign / term / content` | UTM en URL | Filtrable en `/admin/funnel` y `/admin/empresa` |

Reglas prácticas:
- Un lead que llega de un anuncio de Meta a `/meta-ads` → `landing_intent='meta-ads'`, `fbclid` seteado, `utm_source='fb'` (típico). Tráfico orgánico de FB entra por `/facebook` → mismo `landing_intent` pero sin `fbclid` ni `utm_source`.
- Un lead que llega desde el email de Stiv sin campaña → `landing_intent=null` (o `direct` si usó el atajo del CTA verde).
- Un lead que llega desde Google Ads → tiene `gclid`, sin `fbclid`. Su landing es una de las SEO (típicamente `curso-online`).

---

## 3. Tracking y atribución

Todo el tracking client-side vive en `web/lib/pixels.ts` + `web/components/PixelTags.tsx` + `web/components/confirmacion/*`. El server-side vive en `web/app/api/meta-capi/route.ts` + el cron de conversion export.

### 3.1 Meta Pixel (browser)

- **Pixel ID**: `2233507904101190` — env `NEXT_PUBLIC_META_PIXEL_ID`.
- **Inyección**: `PixelTags.tsx` en `web/app/layout.tsx` (root layout → todas las páginas).
- **Eventos disparados**:
  - `PageView` en cada carga (auto).
  - `Lead` en `firePixelLead()` al hacer submit del formulario en `/agendar/cuando`.
  - `Schedule` en `ConfirmacionPixel.tsx` al montar `/confirmacion` — con `eventID` UUID para dedup con CAPI.
  - `Purchase` en `ConfirmacionDepositPurchase.tsx` cuando el lead vuelve de Stripe con `?deposito=ok` — con `eventID` UUID para dedup con CAPI (valor 10 EUR).

### 3.2 Meta CAPI (server)

- Endpoint: `POST /api/meta-capi` (`web/app/api/meta-capi/route.ts`).
- **Envs**: `META_CAPI_TOKEN` (Graph API token), `NEXT_PUBLIC_META_PIXEL_ID`, `META_TEST_EVENT_CODE` (opcional — cuando está seteado los eventos van al bucket de Test Events de Meta en vez del real).
- **Eventos soportados**: `Schedule` (default), `Purchase` (con `value` + `currency` requeridos).
- **Dedup**: el cliente pasa el mismo `eventId` que usa `fbq(...)` browser-side → Meta deduplica en ventana de 48h.
- **User data enviado**: SHA-256 hash de `email` + `phone` (formato digits-only), `client_ip_address`, `client_user_agent`, `fbc` (leído del Cookie header — Meta lo mantiene 1st-party), `fbp` (idem).
- **URL**: `graph.facebook.com/v21.0/{PIXEL_ID}/events`.

### 3.3 Google Ads

- **Account ID**: `AW-17724667323` — hardcodeado en `web/app/layout.tsx`.
- **Enhanced Conversions**: activadas — `gtag('config', ..., { allow_enhanced_conversions: true })`. Antes de `event('conversion')` hacemos `gtag('set', 'user_data', { email, phone_number })` que Google hashea SHA-256 client-side y matchea con Google Signals. Recuperación típica ~30% de conversiones que no traen `gclid`.
- **Conversiones definidas**:
  - **"Clase agendada"** (`AW-17724667323/YjyxCIjcqMocELvr44NC`, 30 EUR): dispara en `/confirmacion` vía `firePixelScheduleGoogle`. `transaction_id=classId` → dedup nativo Google Ads.
  - **"Depósito pagado"** (`AW-17724667323/sUtlCPGhqcocELvr44NC`, 10 EUR): env `NEXT_PUBLIC_GADS_DEPOSIT_LABEL`. Dispara en `/confirmacion?deposito=ok` vía `ConfirmacionDepositPurchase`. `transaction_id={classId}-deposit` (distinto del anterior para no colisionar).
- **Offline conversions export**: cron `/api/cron/ads-conversions-export` (`web/app/api/cron/ads-conversions-export/route.ts`) escribe a un Google Sheet que Google Ads importa periódicamente. **Estado real**: implementado y corriendo hourly, pero **frágil** (ver §8). Dos conversiones importadas offline:
  - `GADS_CONVERSION_NAME` = "Cliente convertido (offline)" — 300 EUR, filtra `status='converted' AND gclid IS NOT NULL AND ads_conversion_uploaded_at IS NULL`.
  - `GADS_ATTENDED_CONVERSION_NAME` = "Asistió a clase de prueba" — 15 EUR, filtra `trial_attended_at NOT NULL AND gclid IS NOT NULL AND ads_attended_uploaded_at IS NULL`.

### 3.4 TikTok Pixel

- **Pixel ID**: env `NEXT_PUBLIC_TIKTOK_PIXEL_ID`.
- **Eventos**: `CompleteRegistration` en submit del form, `Subscribe` en Schedule.
- **Estado**: activo pero sin optimización de campañas en TikTok Ads (no hay budget corriendo).

### 3.5 GA4

**NO existe**. Nunca se instaló. Todo el análisis de embudo se hace desde el dashboard interno `/admin/funnel` que lee la tabla `funnel_progress` (ver §3.6).

### 3.6 Telemetría propia (`funnel_progress`)

Tabla `funnel_progress` — cada paso del embudo se registra como una fila:

```
session_id (cookie aa_session_id, 30 días)
step (int) → ver FUNNEL_STEP en lib/track-funnel.ts
answer (text, opcional — la opción elegida en el paso)
landing_intent (text)
ip_hash (SHA256(ip + NEXTAUTH_SECRET))
user_agent (text)
created_at (timestamptz)
```

**Códigos de step**:
- Legacy 1-6 (quiz Diagnóstico): 1=motivo, 2=nivel, 3=form_opened, 4=field_typed, 5=submit_attempt, 6=submit_ok.
- Nuevos 10-16 (2026-07-19, flow landing→trial): 10=landing_view, 11=cta_click, 12=slot_page_view, 13=day_picked, 14=slot_picked, 15=phone_valid, 16=commitment_checked.

- **Endpoint público**: `POST /api/public/track-funnel` (rate-limit 60/min/IP, dedup client-side por session+step).
- **Vista**: `/admin/funnel` → waterfall con conversión step-a-step + comparador por landing + drill-down a session_ids que abandonan cada paso. CSV export.

### 3.7 Tabla evento × funnel

| Evento | Funnel estándar (todas las landings) | Funnel `/meta-ads-paid` (nuevo) |
|---|---|---|
| Meta `PageView` (fbq) | ✅ en landing | ✅ en landing |
| Meta `Lead` (fbq) | ✅ al submit form | ❌ (el submit del wizard va directo a Stripe) |
| Meta `Schedule` (fbq + CAPI, dedup eventID) | ✅ en `/confirmacion` | ✅ en `/confirmacion` (mismo componente) |
| Meta `Purchase` (fbq + CAPI, dedup eventID) — 10 EUR | ✅ si el lead activa Reserva Prioritaria post-agenda | ✅ si pagó el depósito (retorno de Stripe) |
| Google Ads "Clase agendada" (gtag) — 30 EUR | ✅ en `/confirmacion`, tx_id=classId | ✅ idem |
| Google Ads "Depósito pagado" (gtag) — 10 EUR | ✅ igual que Meta Purchase | ✅ idem |
| Google Ads offline "Cliente convertido" — 300 EUR | ✅ cuando el lead paga pack (cron) | ✅ idem |
| Google Ads offline "Asistió a clase de prueba" — 15 EUR | ✅ cuando asiste al trial (cron) | ✅ idem |
| TikTok `CompleteRegistration` (ttq) | ✅ al submit form | ❌ |
| TikTok `Subscribe` (ttq) | ✅ en Schedule | ✅ idem |
| `funnel_progress` steps 10-16 | ✅ toda la cadena | ✅ toda la cadena (con landing_intent='meta-ads-paid') |

---

## 4. Campañas activas

**No están documentadas en el repo**. La estructura vive únicamente en el Business Manager de Meta y en la cuenta de Google Ads. Esta es una **deuda documental prioritaria** (ver §8).

### 4.1 Meta

- **Business Manager**: Aprender-Aleman.de (admin: Gelfis Horn — cuenta personal + cuenta business).
- **Cuenta publicitaria**: 1 activa (ES/DE); histórico de campañas separadas por país (España, Alemania, Suiza).
- **Pixel**: `2233507904101190`.
- **CAPI Access Token**: env `META_CAPI_TOKEN` — token de sistema de larga duración generado en Events Manager → Settings → Conversions API.
- **Estado A/B actual**: campaña control apuntando a `/meta-ads` + campaña experimento apuntando a `/meta-ads-paid`. Budget: pequeño para el paid mientras se valida (~10-20% del gasto total). Optimización: por "Cita agendada" (Meta le llama `Schedule` en la API).

**Acceso**: Meta Business Manager (admin único: Gelfis). No hay lista de usuarios documentada. En caso de traspaso: transferir ownership del Business Manager al nuevo admin en `business.facebook.com/settings/people`.

### 4.2 Google Ads

- **Cuenta**: `AW-17724667323` — admin único Gelfis.
- **Estructura activa**: campañas por país (España, Alemania, Suiza), formato Search + PMax mixto. Cada país con landing dedicada (`/curso-aleman-online`, `/clases-particulares-aleman-online`, etc.).
- **Optimización**: tCPA por campaña.
- **Conversiones importadas**: "Clase agendada" (online, en tiempo real), "Depósito pagado" (online), "Cliente convertido (offline)" (import diario via cron→Sheet), "Asistió a clase de prueba" (idem).

**Herramientas admin en el repo**:
- `/admin/empresa/costes` → upload de CSV de costes de Google Ads (`AdsUpload.tsx`).
- `/admin/ads` → dashboard de leads por landing con CPA.
- Skill de Claude Code `aprender-aleman-google-ads` para análisis mensual + recomendaciones.

### 4.3 TikTok Ads

Instalado pero **sin budget activo** actualmente. Solo tracking pasivo.

---

## 5. Experimentos en curso

### 5.1 `/meta-ads-paid` — depósito 10€ opcional

**Estado**: implementación live (2026-07-28). Coexiste con `/meta-ads` sin tocarlo. Migration 088 aplicada.

**Hipótesis**: pedir un depósito reembolsable de 10€ (que se descuenta del programa si el lead compra) filtra leads no serios y aumenta el show-rate de la clase de prueba + la conversión a pack.

**Cómo se mide**:
- Filtro por `leads.landing_intent = 'meta-ads-paid'` vs `'meta-ads'` en `/admin/funnel`.
- Métricas por bucket ya calculadas: leads captados, form completado, trial agendada, tasa de asistencia, tasa de conversión a pack.
- Métrica extra: **% attach del depósito** = COUNT(`reserva_prioritaria=true`) / COUNT(`landing_intent='meta-ads-paid'`).
- Attribution Stripe: cada session lleva `metadata.attribution_source='meta-ads-paid'` → filtrable en Stripe reports.

**Geo-split A/B**: pendiente de implementación explícita. Actualmente Meta lleva a `/meta-ads-paid` en la campaña experimento, `/meta-ads` en el control — sin geo-split forzado por país. Si se quiere split más limpio: crear conjuntos de anuncios por región y apuntarlos a cada landing.

**Riesgos del experimento**:
- Puede matar conversiones frías (leads que no darían tarjeta pero convertirían por WA follow-up).
- Requiere que el flow Stripe sea sólido — si Stripe cae, el lead sigue con la cita agendada (el pago no bloquea la reserva, solo dora al lead).

### 5.2 Reserva Prioritaria post-agenda (todas las landings)

Complementario al 5.1: en `/confirmacion` mostramos un botón para pagar los 10€ como upgrade opcional, sin importar la landing de origen. Comparte webhook + flags + tracking.

---

## 6. Integraciones y dependencias

### 6.1 CRM (tabla `leads` y `lead_timeline`)

- Escribimos: `leads` (INSERT o UPDATE) y `classes` (INSERT).
- Escribimos: `lead_timeline` con eventos de audit (`type='status_change' | 'agent_note' | 'system_message_sent' | ...`).
- **Deduplicación de leads**: match por `email` OR `whatsapp_normalized` (índice compuesto en migration inicial). First-touch preservado para ad attribution.
- **Handoff al CRM**: `status='trial_scheduled'` + `trial_scheduled_at` → el CRM operativo (otro dev) toma desde ahí (Stiv agente de WA, panel admin, panel closer).

### 6.2 Stripe

- **Cuenta**: US (histórica; existen legacy claves DE para pagos antiguos, no se usan para depósito).
- **Envs**: `STRIPE_SECRET_KEY_US`, `STRIPE_WEBHOOK_SECRET_US`, `STRIPE_DEPOSIT_PRICE_ID_US` (`price_1TpDgk2KdZIeUfmjnJkDbUiN`).
- **Endpoints que crean checkout sessions**:
  - `POST /api/public/deposit-checkout` — depósito opt-in desde `/confirmacion`.
  - `POST /api/public/book-trial-metaads-paid` — depósito integrado en el wizard.
- **Webhook único**: `/api/webhooks/stripe/us` → `_shared.ts::processStripeEvent`. Idempotente vía tabla `stripe_events`.
- **`metadata.type` que gestionamos** en esta capa: `trial_deposit`, `trial_deposit_metaads`. Ambos flipean `leads.reserva_prioritaria=true`, `reserva_prioritaria_paid_at`, `reserva_prioritaria_amount_cents`, timeline entry. Otros types (`package`, `subscription`) los gestiona la capa de billing (otro dev).

### 6.3 Mensajería (WhatsApp + email)

- **Nuestra responsabilidad**:
  1. Programar la notificación → `classes.notify_after_at = NOW()` (funnel estándar) o `NOW+13min` (funnel paid, para no colisionar con el flow Stripe).
  2. Marcar el flag de estado → `reserva_prioritaria=true` para que el mensaje sea la variante VIP.
- **Responsabilidad del layer mensajería**:
  - El cron `send-trial-notifications` lee `classes WHERE notify_after_at <= NOW() AND notified_at IS NULL`, elige plantilla según flags, y envía por email (Resend) + WhatsApp (Evolution API).
  - Sus reintentos, rate-limit, plantilla i18n, opt-outs — todo eso vive en el anexo de mensajería.

### 6.4 Google Calendar

- El endpoint `book-trial` (después de responder al lead) crea eventos en:
  1. Google Calendar de la academia (calendario compartido).
  2. Google Calendar personal del profesor asignado.
- Si el patch falla en un auto-reschedule, hacemos rollback (revertimos el UPDATE de la clase).

---

## 7. Operación

### 7.1 Cómo lanzar una landing nueva de campaña

1. Copia el archivo de una landing existente (ej. `web/app/meta-ads/page.tsx`).
2. Cambia:
   - Route (`web/app/mi-nueva-landing/page.tsx`).
   - `landing_intent` en las props (nuevo slug, ej. `linkedin-ads`).
   - Copy (h1, subtitle, bullets, `ctaLabel`).
   - Si es paid orgánico: `robots: { index: false, follow: true }`.
3. Añade el slug en el mapa `LANDING_META` de `web/app/admin/funnel/page.tsx` para que aparezca con label y color en el dashboard.
4. Deploy (`git push` → Vercel auto-deploy ~2 min).
5. Configura la campaña Meta/Google apuntando a `https://b2c.aprender-aleman.de/mi-nueva-landing`.
6. Verifica en `/admin/funnel` que empiezan a caer `landing_view` de esa nueva `landing_intent`.

### 7.2 Cómo cambiar un presupuesto

**Fuera del código**. Se hace en Meta Ads Manager / Google Ads UI directamente. El código no tiene ninguna config de presupuestos — es solo capa de captura + tracking.

### 7.3 Los 3 errores más comunes (histórico)

1. **`lead_create_failed` por enum inválido** (2026-07-28): al añadir el wizard de `/meta-ads-paid` el mapper de `goal` mandaba valores fuera del enum `lead_goal` de Postgres (`study`, `official`, `daily`, `moving`). El INSERT reventaba con `invalid input value for enum`. Fix: mapper corregido a valores válidos (`work | studies | visa | already_in_dach | travel`). **Aprendizaje**: cualquier nuevo campo enum → probar con un submit real, no solo tsc.

2. **Niveles MCER rechazados por el schema Zod** (histórico pre-2026-06): el schema aceptaba `A0/A1/A2/B1/B2/C1` pero el frontend mandaba variantes como `A1.1`, `A2.2`, `A1-A2`, `B2+`. El submit fallaba con `validation_failed`. Fix: expandido el enum de `german_level` para aceptar todas las variantes históricas (ver `book-trial/route.ts:72-75`).

3. **Meta CAPI enviando eventos al bucket real en vez del Test Events** (2026-07-25): el env `META_TEST_EVENT_CODE` estaba solo en `.env.local` (Vercel lo ignora). Los eventos de prueba entraban al bucket real y contaminaban las estadísticas. **Aprendizaje**: los envs `NEXT_PUBLIC_*` van al bundle del cliente y sí necesitan estar en Vercel; los sin prefix son server-only. Todo cambio de env → confirmar en Vercel dashboard, no solo local.

Bonus 4: **Stripe deposit checkout devolvía 500 opaco** cuando `STRIPE_SECRET_KEY_US` no estaba seteada en Vercel (2026-07-25). Fix: wrapper outer try/catch en el endpoint que ahora devuelve 502 con `detail` legible.

### 7.4 Monitorización

- **No hay Sentry / Datadog / LogRocket**. Solo `console.error/warn` en los endpoints.
- **Notificación por email** en cada nuevo lead → `NEW_LEAD_ALERT_EMAIL` (default: gelfis). Sirve como heartbeat pasivo: si no llega nada en 24h en horario normal, algo se cayó.
- **Cron `data-integrity-check`** revisa consistencia entre `leads` y `classes` (huérfanos, trials sin lead, etc.) — daily.
- **Cron `messaging-health-daily`** revisa que el layer de mensajería no esté atascado.
- **Cron `webhook-self-heal`** re-procesa eventos Stripe fallidos.
- **NO hay pager/oncall**. Si el funnel se cae un sábado a las 22:00, nos enteramos el domingo cuando Gelfis mire el email o el dashboard.

**Recomendación al comprador**: en las primeras semanas post-adquisición, instalar Sentry (o similar) apuntado a `web/`. Los endpoints `book-trial`, `book-trial-metaads-paid`, `meta-capi`, `deposit-checkout` y el webhook `stripe/us` son los 5 críticos.

---

## 8. Deuda técnica y riesgos

### 8.1 Fragilidades conocidas

- **Fallbacks silenciosos en envs**: varios envs tienen defaults hardcodeados que "funcionan en prod" pero que son bombas de tiempo si algo cambia. Los más críticos:
  - `NEXT_PUBLIC_STRIPE_DEPOSIT_URL` → fallback a un Payment Link hardcodeado (`buy.stripe.com/bJe6oAcXzd9W2xFedx0co0n`). Si ese link se revoca desde Stripe y la env no está seteada, los mensajes WA salen con un link roto.
  - `GADS_CONVERSION_NAME` / `GADS_ATTENDED_CONVERSION_NAME` → si el nombre no matchea exactamente con Google Ads UI, el cron sube filas y Google las rechaza silenciosamente. No hay alarma.
  - `NEXTAUTH_SECRET` fallback `"aa-fallback"` en `track-funnel` (para el ip_hash) — si falta, el hash es guessable.
- **Log verboso en prod**: `POST /api/meta-capi` loguea `payload → …` con el evento entero. Diagnóstico útil pero deja huella en Vercel Logs.
- **Copy operacional que no se cumple**: el WA de confirmación dice "sin tu respuesta en 12h, tu slot se libera para otro estudiante en lista de espera" — **no hay ningún cron que libere el slot en 12h**. Es presión comercial, no verdad técnica. Verifica antes de asumir que el sistema hace lo que el mensaje promete.
- **`firePixelSchedule` en `lib/pixels.ts`**: el nombre engaña — ya no emite Meta Schedule (se movió a `/confirmacion`), solo emite TikTok Subscribe. Alguien que lo llame esperando Meta se llevará una sorpresa.

### 8.2 Dependencias de una sola persona

- **Meta Business Manager y Google Ads**: single admin (Gelfis). Traspaso requiere transferir ownership formal.
- **Stripe US account**: idem — admin único.
- **Google Sheet de conversiones offline**: hosted en la cuenta de Google de Gelfis. Cron escribe con service account, pero si el sheet se borra o cambia de dueño → el cron rompe silenciosamente.
- **Cron secrets**: `CRON_SECRET` es la única credencial que autoriza los crons de Vercel. Si se filtra, cualquiera puede disparar los exports.

### 8.3 Lo que NO tocaría sin cuidado

1. **`book-trial/route.ts`** — 800 líneas, muchas capas (rate limit, upsert lead con first-touch, class insert, GCal patch, auto-reschedule, Zoom link, notify_after_at, timeline audit). Cualquier cambio → probar con un submit real, no solo tsc, y verificar que la conversión Meta Schedule llega al Events Manager.
2. **`_shared.ts` del webhook Stripe** — idempotente vía `stripe_events`, pero si duplicamos una rama sin cuidado podemos pasar 2× el flag `reserva_prioritaria`. Chequear el guard.
3. **Migración de `funnel_progress`** — la tabla crece rápido (60/min/IP × N landings × N leads). Sin partitioning ni retention policy. Ya son ~500k rows en 2 meses. Recomendación: TTL 90 días + partition por mes.
4. **`NEXTAUTH_SECRET`** — se usa en 3 sitios (auth NextAuth, `ip_hash` de funnel_progress, HMAC de trial-token). Rotarlo invalida TODOS los magic-links de trials históricos → leads que abran su email quedan bloqueados.

### 8.4 Backlog prioritario

En orden de impacto:

1. **Documentar la estructura de campañas Meta + Google** en `docs/ads-campaigns.md` — hoy solo vive en la cabeza de Gelfis.
2. **Instalar Sentry** apuntado a `web/` para captar 5xx en endpoints críticos.
3. **Health check activo del cron ads-conversions-export**: alertar si `ads_conversion_uploaded_at` no avanza en 24h.
4. **TTL + partition en `funnel_progress`**: retention 90 días.
5. **Consolidar los 2 flujos de depósito** (`deposit-checkout` y `book-trial-metaads-paid`) en un helper compartido — hoy duplican lógica Stripe.
6. **Retirar el log verboso** de `/api/meta-capi` una vez confirmado que Purchase funciona en prod real (ya validado 2026-07-25).
7. **Alinear el copy del WA** ("se libera en 12h") con la realidad — o implementar el cron que libera.

---

## Apéndice A · Envs críticas de esta capa

Todos deben estar seteados en Vercel Production. Los `NEXT_PUBLIC_*` van al bundle cliente.

| Env | Uso | Impacto si falta |
|---|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel + CAPI | Ningún tracking Meta |
| `META_CAPI_TOKEN` | Meta CAPI Graph API | CAPI devuelve 503 not_configured |
| `META_TEST_EVENT_CODE` | Solo diagnóstico | Sin — mantener sin setear en prod |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | TikTok Pixel | Sin tracking TikTok |
| `NEXT_PUBLIC_GADS_DEPOSIT_LABEL` | Conversión depósito Google | Fallback hardcodeado OK |
| `STRIPE_SECRET_KEY_US` | Checkout + webhook US | Depósitos rompen |
| `STRIPE_WEBHOOK_SECRET_US` | Verificar webhook Stripe | Webhook devuelve 401 |
| `STRIPE_DEPOSIT_PRICE_ID_US` | Price ID del 10€ | Fallback a `price_data` inline OK |
| `NEXT_PUBLIC_STRIPE_DEPOSIT_URL` | Payment Link en WA/email | Fallback hardcodeado — frágil (§8.1) |
| `PLATFORM_URL` | URLs absolutas en emails/WA | Fallback `https://b2c.aprender-aleman.de` (OK prod, mal preview) |
| `NEXT_PUBLIC_SITE_URL` | Idem cliente | Idem |
| `NEXTAUTH_SECRET` | HMAC de magic-links | Rotar = invalida todo |
| `CRON_SECRET` | Auth de crons | Crons devuelven 401 |
| `BOOK_TRIAL_RATE_LIMIT_MAX` | Cap del rate limit | Default 5/h/IP |
| `NEW_LEAD_ALERT_EMAIL` | Notificación por email | Sin alerta de nuevo lead |

## Apéndice B · Migrations relevantes

| Migration | Qué añade |
|---|---|
| `048_lead_motivo_inicial.sql` | Tabla `lead_motivo_inicial` para trackear el paso 1 del quiz |
| `054_funnel_progress.sql` | Tabla `funnel_progress` para telemetría de embudo |
| `056_ads_conversion_tracking.sql` | `leads.gclid, conversion_value, ads_conversion_uploaded_at` |
| `058_landing_intent.sql` | `leads.landing_intent` |
| `064_motivo_direct.sql` | Añade valor `'direct'` al enum motivo |
| `065_ads_attended_tracking.sql` | `leads.ads_attended_uploaded_at` |
| `078_deferred_trial_notifications.sql` | `classes.notify_after_at, notified_at` (para el delay de mensajería) |
| `085_funnel_progress_widen_step.sql` | Widen `step` a int para codes 10-16 |
| `086_reserva_prioritaria.sql` | `leads.reserva_prioritaria, reserva_prioritaria_paid_at, reserva_prioritaria_amount_cents, fbclid` |
| `088_meta_ads_paid_funnel.sql` | `leads.qualification_answers, deposit_intent_at, priority_deadline` |

---

*Fin del documento. Última revisión: 2026-07-28.*
