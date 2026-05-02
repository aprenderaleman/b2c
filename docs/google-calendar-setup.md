# Google Calendar — setup paso a paso

**Para qué**: cada clase de prueba que un lead reserva por
`/agendar` aparece automáticamente en el calendar personal de
Gelfis (`aprenderaleman2026@gmail.com`) y, además, el lead recibe
un `.ics` adjunto al email para añadir el evento a su propio
calendar con un clic.

**Estado del código**: completo y commiteado. Está env-gated — no
hace nada hasta que rellenes las dos env vars en Vercel. Esta guía
es para que tú (Gelfis) hagas el setup en Google Cloud Console y
configures Vercel.

**Tiempo estimado**: 10 min.

---

## 1. Crear proyecto en Google Cloud Console

1. Entra a <https://console.cloud.google.com/>.
2. Arriba, junto al logo, hay un selector de proyecto. Pulsa →
   **New Project**.
3. Nombre: `aprender-aleman-calendar` (o el que prefieras).
   Organization: déjalo vacío (cuenta personal).
4. Pulsa **Create**. Espera 10 s a que se cree.
5. Selecciónalo en el selector de proyecto.

## 2. Activar la Google Calendar API

1. Menú izquierdo → **APIs & Services → Library**.
2. Busca **Google Calendar API**.
3. Pulsa **Enable**. Tarda 5 s.

## 3. Crear la Service Account

1. **APIs & Services → Credentials** (o **IAM & Admin → Service
   Accounts**, da igual).
2. **+ Create Service Account**.
3. **Service account name**: `b2c-trial-bookings`.
4. **Service account ID** (autogenerado): déjalo como esté.
5. **Description**: `Crea eventos de clases de prueba en el
   calendar de Gelfis`.
6. Pulsa **Create and Continue**.
7. **Grant this service account access to project**: NO necesitas
   ningún rol. Pulsa **Continue**.
8. **Grant users access to this service account**: nada. **Done**.

Ya tienes la SA. Apunta su email — algo tipo
`b2c-trial-bookings@aprender-aleman-calendar.iam.gserviceaccount.com`.

## 4. Generar la clave JSON de la SA

1. En la lista de Service Accounts, pulsa la que acabas de crear.
2. Pestaña **Keys** → **Add Key → Create new key**.
3. Tipo **JSON**. Pulsa **Create**. Te descarga un archivo `.json`.
4. **GUÁRDALO BIEN** (tu password manager, por ejemplo). No lo
   pegues en chats. No subas el archivo a git.

El JSON contiene `private_key`, `client_email`, etc. — eso es lo
que pegamos en Vercel.

## 5. Compartir tu calendar con la Service Account

Aquí está el truco: la SA por defecto no tiene acceso a TU calendar.
Tú se lo das compartiéndolo, igual que compartirías un calendar con
un colega.

1. Entra a <https://calendar.google.com/> con
   `aprenderaleman2026@gmail.com`.
2. En el sidebar izquierdo, pasa el ratón sobre el calendar
   principal (`Aprenderaleman2026` o `aprenderaleman2026@gmail.com`)
   → 3 puntitos → **Settings and sharing**.
3. Scroll a **Share with specific people or groups**.
4. **Add people and groups**.
5. Pega el email de la SA (paso 3.7).
6. Permission: **Make changes to events** ← **importante**.
7. **Send**. (No te pide email de confirmación porque es una SA.)

## 6. Calendar ID

En la misma pantalla de Settings, scroll a **Integrate calendar** →
**Calendar ID**. Para tu calendar principal será exactamente
`aprenderaleman2026@gmail.com`. Cópialo.

## 7. Pegar las env vars en Vercel

Settings → Environment Variables → Add:

| Key | Value | Environments |
|---|---|---|
| `GOOGLE_CALENDAR_ID` | `aprenderaleman2026@gmail.com` | Production + Preview + Development |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",…}` (todo el contenido del archivo JSON, en una sola línea, sin comillas externas) | Production + Preview + Development |

Para `GOOGLE_SERVICE_ACCOUNT_JSON`: abre el archivo JSON con un
editor, copia TODO el contenido (incluyendo las llaves `{}`), pégalo
como valor. Vercel lo trata como string.

Después: **Deployments → último → ⋯ → Redeploy** para que entren
en runtime.

## 8. Probar

Reserva una clase de prueba en `/agendar` con un email tuyo de
prueba (ej. otro Gmail). Debería pasar:

1. La clase se crea en la BD (igual que antes).
2. En **Google Calendar de Gelfis** aparece un evento nuevo:
   - Título: `Clase de prueba — <Nombre> (con <Profe>)`
   - Hora: el slot que reservó el lead, en hora Berlín.
   - Descripción: detalles del lead + URL del aula.
   - Sin recordatorios (decisión Gelfis).
3. El email que recibe el lead lleva un adjunto
   `clase-de-prueba-aleman.ics`. Si lo abre desde Gmail / Outlook /
   Apple Mail → se le ofrece "Añadir al calendar".
4. En `/admin/leads/{id}` hay una nota nueva en el timeline:
   `📅 Evento creado en Google Calendar (abc12345…)`.

## 9. Cancelaciones

Cuando alguien cancela una clase desde `/admin/clases/{id}` (o el
profe via `/api/teacher/classes/{id}`), el código llama
automáticamente `deleteTrialEvent()` con el `event_id` guardado y
limpia el evento del Google Calendar. Best-effort: si falla, la
cancelación de la BD prevalece y se logueamos un warning.

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| El evento no aparece en mi calendar | Olvidaste compartir el calendar con la SA (paso 5). Sin ese paso, la SA crea el evento en SU propio calendar (que no ves). |
| Vercel logs: `GOOGLE_SERVICE_ACCOUNT_JSON not valid JSON` | El valor tiene comillas extra o saltos de línea raros. Pegar el contenido exacto del archivo JSON. |
| Vercel logs: `forbidden` | La SA no tiene permiso "Make changes to events" en tu calendar. Reabre Settings del calendar y verifica. |
| `Calendar usage limits exceeded` | La cuota gratuita de Google Calendar API es ~1M ops/día por proyecto. Imposible alcanzarla con clases de prueba. Si pasa, separa proyecto. |

## Rotar la SA (si comprometes el JSON)

1. Google Cloud → Service Accounts → tu SA → **Keys** → encuentra
   la key vieja → **Delete**.
2. **Add Key → Create new key** → JSON → descarga.
3. Reemplaza el valor en Vercel → Redeploy.

La rotación es instantánea — el evento ya creado no se pierde, y
los nuevos van con la key nueva.

## Si en algún momento decides apagar la integración

Borra `GOOGLE_SERVICE_ACCOUNT_JSON` (o `GOOGLE_CALENDAR_ID`) de
Vercel y redeploy. El código está env-gated: el resto del booking
sigue funcionando exactamente igual, solo deja de crear el evento
espejo (y deja de adjuntar `.ics` si quitamos también su
generación, aunque hoy el `.ics` está siempre adjunto porque no
depende de Google).
