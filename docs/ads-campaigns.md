# Estructura de campañas Meta + Google Ads

**Estado del documento**: 🟡 **PLANTILLA** — Gelfis debe rellenar las secciones marcadas con `⟨PENDIENTE⟩` antes del traspaso (mudanza en 4 semanas, 2026-07-28).

Este documento captura lo que hoy solo vive en la cabeza de Gelfis. Complementa `funnels-ads-tracking.md` (que cubre la capa técnica) con la **operación real** de las campañas: qué está corriendo, con qué presupuesto, quién tiene acceso, y cómo cambiar cosas sin romper.

---

## 1. Accesos

### Meta (Business Manager)

| Campo | Valor |
|---|---|
| Business Manager ID | ⟨PENDIENTE — ID en business.facebook.com/settings/info⟩ |
| Nombre BM | Aprender-Aleman.de |
| Cuenta publicitaria activa | ⟨PENDIENTE — número de act_XXXX en Ads Manager⟩ |
| Pixel ID | `2233507904101190` |
| CAPI Access Token | Env `META_CAPI_TOKEN` en Vercel (Events Manager → Settings → Conversions API → Generate Access Token) |
| Admin único (hoy) | Gelfis Horn (`aprenderaleman2026@gmail.com`) |
| Personas con acceso admin | ⟨PENDIENTE — listar emails⟩ |
| Personas con acceso limitado (edit/analyst) | ⟨PENDIENTE⟩ |
| Método de pago | ⟨PENDIENTE — tarjeta terminada en ####⟩ |
| Facturación mensual habitual (últimos 3 meses) | ⟨PENDIENTE — rango €⟩ |

**Traspaso**: en `business.facebook.com/settings/people` → añadir al nuevo admin, elevarlo a "Business Admin", esperar 7 días de cooldown, luego retirar admin anterior. Nunca elimines al admin único sin confirmar que el nuevo puede logear.

### Google Ads

| Campo | Valor |
|---|---|
| Account ID | `AW-17724667323` |
| Manager account (MCC)? | ⟨PENDIENTE — sí/no; si sí, ID del MCC⟩ |
| Admin único (hoy) | Gelfis Horn |
| Personas con acceso admin | ⟨PENDIENTE — listar emails⟩ |
| Método de pago | ⟨PENDIENTE⟩ |
| Facturación mensual | ⟨PENDIENTE⟩ |

**Conversiones definidas en Google Ads UI** (Tools > Conversions):
- ⟨PENDIENTE⟩ "Clase agendada" — Category: Submit lead form. Value: 30€. Label: `YjyxCIjcqMocELvr44NC`. Count: One.
- ⟨PENDIENTE⟩ "Depósito pagado" — Category: Purchase. Value: 10€. Label: `sUtlCPGhqcocELvr44NC`. Count: One.
- ⟨PENDIENTE⟩ "Cliente convertido (offline)" — Category: Purchase. Value: variable. Import via Sheet: sí (nombre exacto: `Cliente convertido (offline)` — debe coincidir con `GADS_CONVERSION_NAME` env).
- ⟨PENDIENTE⟩ "Asistió a clase de prueba" — Category: Custom. Value: 15€. Import via Sheet: sí (nombre exacto: coincide con `GADS_ATTENDED_CONVERSION_NAME` env).

**Google Sheet destino del export offline**:
- URL: ⟨PENDIENTE⟩
- Owner: Gelfis (cuenta Google personal)
- Service account con edit access: ⟨PENDIENTE — email del SA de Vercel⟩

### TikTok Ads

- Pixel: env `NEXT_PUBLIC_TIKTOK_PIXEL_ID` — ⟨PENDIENTE ID⟩
- Estado: instalado, sin campañas corriendo actualmente.

### Stripe

- Account US: admin único Gelfis. Live keys en env `STRIPE_SECRET_KEY_US`, `STRIPE_WEBHOOK_SECRET_US`.
- Price ID del depósito 10€: `price_1TpDgk2KdZIeUfmjnJkDbUiN`.
- Payment Link público (pegado en WA/email): env `NEXT_PUBLIC_STRIPE_DEPOSIT_URL` (fallback hardcoded `buy.stripe.com/bJe6oAcXzd9W2xFedx0co0n`).

---

## 2. Meta Ads — estructura activa

### 2.1 Cuentas por región

| Región | Cuenta publicitaria | Idioma anuncios | Landing destino (control) | Landing destino (paid A/B) |
|---|---|---|---|---|
| España | ⟨PENDIENTE⟩ | ES | `/meta-ads` | `/meta-ads-paid` |
| Alemania | ⟨PENDIENTE⟩ | ES | `/meta-ads` | `/meta-ads-paid` |
| Suiza | ⟨PENDIENTE⟩ | ES | `/meta-ads` | `/meta-ads-paid` |

### 2.2 Campañas activas (rellenar)

Para cada campaña activa, documentar:

**Campaña N**:
- Nombre en Meta Ads Manager: ⟨PENDIENTE⟩
- Región / ubicaciones objetivo: ⟨PENDIENTE⟩
- Objetivo de la campaña (Conversion / Lead / Traffic): ⟨PENDIENTE⟩
- Optimización: ⟨PENDIENTE⟩ (típico: por evento "Schedule")
- Presupuesto diario / total: ⟨PENDIENTE⟩ €
- Fecha de inicio: ⟨PENDIENTE⟩
- Ad sets:
  - Ad set A: audiencia, ubicaciones, edad, intereses. Landing: `/meta-ads` o `/meta-ads-paid`.
  - Ad set B: (idem)
- Anuncios activos: número aprox, formatos (image/video/carousel).
- KPIs actuales (últimos 30d): CPM, CTR, CPL, CVR trial→pack.

_Instrucción a Gelfis_: exportar el resumen de campañas desde Meta Ads Manager (columnas: Name, Delivery, Budget, Bid strategy, Results, Cost per result, Reach, Impressions, Amount spent) y pegar aquí como tabla markdown.

### 2.3 Audiencias guardadas relevantes

- ⟨PENDIENTE — lista de custom audiences y lookalikes que se usan⟩
- Pixel audiences: "Visitó `/meta-ads` últimos 30 días", "Completó Schedule", "Pagó depósito", etc.
- Lookalikes recomendados: 1% de "convirtió pack" (basado en purchases CAPI).

---

## 3. Google Ads — estructura activa

### 3.1 Campañas activas

Para cada campaña:

**Campaña N**:
- Nombre: ⟨PENDIENTE⟩
- Tipo (Search / PMax / Display): ⟨PENDIENTE⟩
- Región objetivo: ⟨PENDIENTE⟩
- Bid strategy: ⟨PENDIENTE⟩ (típico: tCPA con target = 40-60€)
- Presupuesto diario: ⟨PENDIENTE⟩ €
- Landing principal: ⟨PENDIENTE⟩ (típicas: `/curso-online`, `/particulares`, `/intensivo`, `/certificado`, `/b2-trabajar`, `/ciudades`)
- Keywords negativas globales aplicadas: sí/no
- KPIs últimos 30d: impresiones, clicks, CTR, CPC, CPA por conversión.

_Instrucción a Gelfis_: usar el skill `aprender-aleman-google-ads` de Claude Code para exportar el resumen actual y pegarlo aquí.

### 3.2 Keywords negativas globales

Lista compartida de keywords negativas (evita gastar en tráfico irrelevante):

⟨PENDIENTE — copiar la Shared Negative Keywords List de Google Ads⟩

Sugeridas históricamente: `gratis`, `pdf`, `duolingo`, `youtube`, `curso gratuito`, `descargar`, `torrent`, `netflix`, `academia + [ciudad no DACH]`.

---

## 4. Geo-split del A/B `/meta-ads-paid`

**Objetivo**: separar el experimento paid vs control por región para eliminar overlap de audiencia (leads de la misma persona vistos en ambas variantes → contaminan la señal).

### Propuesta de split

| Región | Variante | Landing | Justificación |
|---|---|---|---|
| España | **Paid (10€)** | `/meta-ads-paid` | Poder adquisitivo medio-alto, aceptación cultural del depósito |
| Colombia + México + Argentina + Chile + Perú | **Control (gratis)** | `/meta-ads` | Fricción del pago con tarjeta más alta en LATAM, arranca sin fricción |
| Alemania (hispanohablantes) | **Paid (10€)** | `/meta-ads-paid` | Ya viven en zona euro, familia con tarjetas |
| Suiza | **Paid (10€)** | `/meta-ads-paid` | Idem |
| Resto | **Control (gratis)** | `/meta-ads` | Muestra pequeña, sin split para no contaminar |

### Implementación en Meta Ads Manager

En cada ad set, forzar la ubicación:
- Ad sets España, Alemania (audiencia hispana), Suiza → destination `/meta-ads-paid`.
- Ad sets LATAM → destination `/meta-ads`.
- Excluir explícitamente las regiones cruzadas para que no haya overlap.

### Medición

- KPI primario: **CPA convertido a pack**, no CPA de trial.
- Ventana: mínimo 4 semanas de datos por variante × región.
- Dashboard: `/admin/funnel` filtrado por `landing_intent` + país (columna `country_code` viene del sniff IP en book-trial).
- Attribution Stripe: `metadata.attribution_source='meta-ads-paid'` en cada Checkout Session.

### Fecha de decisión

⟨PENDIENTE — Gelfis define cutoff. Sugerido: 4 semanas de datos → decisión hard rollout o kill del paid.⟩

---

## 5. Cómo lanzar una campaña nueva

### 5.1 Meta

1. Definir objetivo de negocio (trial agendada, lead qualifier, pack venta).
2. Elegir landing destino existente o crear una nueva (ver `funnels-ads-tracking.md` §7.1 para pasos de landing nueva).
3. En Meta Ads Manager: Create Campaign → Objective (típicamente `Sales` con evento `Schedule` o `Lead`).
4. Ad set: audiencia (custom + lookalike + interests), ubicaciones (respetar geo-split), edad, presupuesto (empezar con €10-30/día para test).
5. Ads: mínimo 3 creatives + 2 copies para dejar que Meta optimice.
6. Instalación de tracking: automática (Pixel + CAPI ya están instalados en la landing). Verificar en Events Manager → Test Events que llegan PageView + Schedule reales tras publicar.

### 5.2 Google Ads

1. Elegir landing SEO existente (`/curso-online`, `/particulares`, etc.) o crear una nueva.
2. Crear campaña Search o PMax.
3. Bid strategy: tCPA con target 40-60€ (basado en histórico).
4. Añadir keywords negativas globales.
5. Verificar que la conversión "Clase agendada" está asignada como conversión primaria de la campaña.

---

## 6. Cómo cambiar un presupuesto sin dañar el aprendizaje del algoritmo

**Meta**:
- Cambio pequeño (±20%): OK en cualquier momento.
- Cambio grande (>50%): pausar 24h, reanudar con nuevo budget — no cambiar en caliente, se resetea el learning phase.
- Nunca duplicar budget de un día para otro sin razón — el algoritmo entra en learning phase y las siguientes 48-72h son ineficientes.

**Google Ads**:
- tCPA: cambiar target CPA en ±15% máximo por vez, esperar 7 días para evaluar.
- Budget: cambios grandes también resetean parcialmente el aprendizaje.

---

## 7. Runbook de emergencia

**Si conversion rate cae >30% de un día para otro**:
1. Verifica que /meta-ads y /meta-ads-paid renderean (curl las URLs).
2. Verifica en `/admin/funnel` si el drop es en `landing_view`, `slot_page_view`, o `submit_ok` (identifica en qué paso se rompe).
3. Verifica Vercel Runtime Logs de `/api/public/book-trial` — busca `validation_failed` o `slot_taken`.
4. Verifica Meta Events Manager que Schedule/Purchase siguen llegando.
5. Verifica Google Ads UI que la cuenta no está en revisión / suspendida.

**Si Meta CAPI deja de recibir eventos**:
1. Chequea Vercel Runtime Logs por `[meta-capi]` — el endpoint loguea payload + respuesta.
2. Verifica `META_CAPI_TOKEN` no ha expirado (los system tokens son long-lived pero pueden revocarse).
3. En Events Manager → Diagnostics: si hay errores, ahí aparecen.

**Si Google Sheet del export offline se rompe**:
1. Verifica que el sheet sigue existiendo con el service account en `web/app/api/cron/ads-conversions-export/route.ts`.
2. Runtime Logs del cron: filtra por `[ads-conversions-export]`.
3. Cron alternativa manual: `curl -X POST https://b2c.aprender-aleman.de/api/cron/ads-conversions-export -H "Authorization: Bearer $CRON_SECRET"`.
4. El cron `ads-export-health` (daily 08:00) manda alerta si detecta el drift.

---

## 8. Checklist pre-traspaso (Gelfis se muda en 4 semanas)

Marca ✅ cuando esté hecho:

- [ ] Rellenar todos los `⟨PENDIENTE⟩` de este doc.
- [ ] Añadir 2-3 admins más al Business Manager de Meta (Gelfis Business Admin + backup).
- [ ] Añadir 2-3 admins más a Google Ads.
- [ ] Documentar métodos de pago en Meta / Google / Stripe (quién puede rotar tarjetas).
- [ ] Exportar CSV de campañas activas actuales (Meta + Google) y pegar en `docs/ads-campaigns-snapshot-2026-08.md` (snapshot histórico).
- [ ] Verificar que Google Sheet del offline export tiene service account con edit (no bloquear cuando Gelfis retire su cuenta personal).
- [ ] Transferir ownership del `NEXT_PUBLIC_STRIPE_DEPOSIT_URL` (Payment Link) a la cuenta operativa del negocio, no personal.
- [ ] Grabar loom de 15 min: "cómo pauso una campaña", "cómo cambio un budget", "cómo interpretar /admin/funnel".
- [ ] Definir on-call: quién revisa `/admin/funnel` cada lunes y qué hace si detecta anomalía.

---

*Última actualización: 2026-07-28. Gelfis: rellenar antes de mudanza.*
