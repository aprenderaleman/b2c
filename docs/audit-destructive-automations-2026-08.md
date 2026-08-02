# Auditoría · Automatismos destructivos sobre clases/leads

**Fecha**: 2026-08-02.
**Detonante**: incidente `trial-slot-release` (14 trials canceladas por interpretar mal la ausencia de confirmación).
**Alcance**: crons `web/app/api/cron/*` + agentes Python en `agents/*.py`.
**Regla aplicada**: [no-auto-cancel-policy.md](./no-auto-cancel-policy.md).

---

## Hallazgos

| # | Ubicación | Trigger | Acción destructiva antes | Severidad | Estado tras 2026-08-02 |
|---|---|---|---|---|---|
| 1 | `agents/agent_4_conversation.py:1280` (`_handle_negative`) | Regex sobre WA entrante: `NEGATIVE_WORDS` (l.89-124) — incluye `cancelar`, `cancela`, `no me interesa`, `gracias por tu tiempo`, `mejor no`, `por ahora no`, `tomaré clases`, `stop`, etc. + alemanes. | `update_status(lead,"lost")` + goodbye WA. | **HIGH** | 🐍 **PENDIENTE** — código Python en VPS. Fix pattern: reemplazar por `update_status(lead,"needs_human")` + timeline "posible cierre — revisar", sin goodbye WA. |
| 2 | `agents/reschedule_flow.py:496-534` (`_handle_absent_interest_no`) + detector l.137-148 | Lead en `AWAITING_ABSENT_INTEREST`, regex prioriza NO sobre YES; matches `no\|nope\|nunca\|ya no\|olvida\|nein\|kein interesse`. | `UPDATE leads SET status='lost'` + close WA. | **HIGH** | 🐍 **PENDIENTE** — Python. Fix: quitar la rama NO destructiva; el silencio del lead ya es señal, no cerrar. |
| 3 | `agents/reschedule_flow.py:571-611` (`_cancel_class_and_notify_teacher`) + detector l.70-75 | Regex `cancelar\|cancela\|cancelo\|no podré\|no voy a poder\|absagen\|stornieren`. | `UPDATE classes SET status='cancelled'`, notify teacher, rollback lead status. | **HIGH** | 🐍 **PENDIENTE** — Python. Fix: quitar la cancelación automática; el detector debe solo notificar al profe/admin ("posible cancelación — confirmar"). |
| 4 | `web/app/api/email-action/absent-interest-no/route.ts` | Click en botón "NO" del email absent-interest. | `UPDATE leads SET status='lost'` + close WA. | **MED** | ⚠️ **REVISAR** — hoy es click explícito, pero misclick / curiosidad = lead perdido. Cambiar a "confirmar cierre" step o retirar el botón. |
| 5 | `web/app/api/cron/trial-auto-absent/route.ts` | Time-based: `trial_scheduled_at < NOW-24h` sin marker. | Marcaba `leads.status='trial_absent'` + entraba en absent-interest flow (→ cascada a #2). | **HIGH** | ✅ **CORREGIDO 2026-08-02** — ahora solo NOTIFICA (timeline + email digest al admin). No modifica status ni entra en flows. |
| 6 | `web/app/api/cron/trial-slot-release/route.ts` | Time-based: notified >12h + no confirmed + slot en próximas 24h. | Cancelaba clase + rollback lead a `in_conversation`. | **HIGH histórico** | ✅ **ELIMINADO 2026-08-02** — endpoint devuelve 410 Gone permanentemente. Removido del `vercel.json`. |
| 7 | `web/app/api/cron/close-stale-classes/route.ts` | Time-based: `classes.status='scheduled' AND scheduled_at < NOW-12h`. | Marcaba `status='completed'` + billed_hours + TODOS los participants como `no_show`. | **HIGH** | ✅ **CORREGIDO 2026-08-02** — ahora solo NOTIFICA (badge `[stale_class_notified_YYYY-MM-DD]` en notes_admin). Humano cierra. |
| 8 | `web/app/api/cron/post-trial-followups/route.ts:190` | Time-based: 3ª de 3 drip messages post-trial. | `UPDATE leads SET status='cold'`. | **MED** | ⚠️ **REVISAR** — drip terminus, expected. Aceptable si Gelfis confirma; alternativa es `needs_human` en su lugar. Backlog. |
| 9 | `web/app/api/cron/diagnostico-followups/route.ts:709` | Time-based: drip msg 8 (~14 días sin respuesta). | `UPDATE leads SET status='lost'`. | **MED** | ⚠️ **REVISAR** — igual que #8, más agresivo (`lost` es irreversible en KPIs). Backlog. |
| 10 | `agents/agent_5_guardian.py:206-237` (`_process_absent_followup`) | Time-based hourly: después de `absent_followup_3`. | `UPDATE leads SET status='lost'` + "liberamos tu espacio" WA. | **MED** | 🐍 **REVISAR** — Python. Alineado con #8; considerar cambiar a `needs_human`. |
| 11 | `agents/shared/leads.py:154,160,265-282` (`_mark_cold`) | Time-based: contacto 3 sin reads o contacto 5. | `UPDATE leads SET status='cold'`. | **MED** | 🐍 **REVISAR** — Python, drip terminus tradicional. Menor prioridad. |
| 12 | `agents/agent_3_sender.py:297-316` (`_mark_lead_invalid_phone`) | Evolution WA rechaza el número. | `UPDATE leads SET status='lost'`. | **LOW** | 🐍 **REVISAR** — Python. Riesgo: outage WA misclasificado como número inválido → pérdida masiva. Añadir throttle/quorum. |

## Fixes aplicados en esta capa (TypeScript)

### ✅ `trial-auto-absent` — patrón notify-only

Antes: iteraba leads y llamaba a `markTrialAbsent()` que a su vez iniciaba `AWAITING_ABSENT_INTEREST` (cascada peligrosa por #2).
Ahora: inserta timeline entry `type='agent_note'` con `metadata.kind='trial_pending_review'` + envía email diario al admin con la lista. **NO modifica leads.status, NO cancela clases, NO inicia absent-interest flow.**

Idempotencia: check `WHERE metadata->>kind='trial_pending_review' AND created_at >= HOY` antes de insertar.

### ✅ `trial-slot-release` — endpoint eliminado

`GET` y `POST` devuelven **410 Gone** permanentemente. Comentario prominente en `route.ts`. Removido del `vercel.json`.

### ✅ `close-stale-classes` — patrón notify-only

Antes: marcaba `status='completed'` + `billed_hours` + participants como `no_show` silenciosamente.
Ahora: añade badge `[stale_class_notified_YYYY-MM-DD]` a `notes_admin` (idempotente por día). Un humano cierra desde /admin o /profesor.

### ✅ `send-trial-notifications` — copy sin amenaza

Antes: *"Sin tu respuesta en 12h, tu slot se libera para otro estudiante en lista de espera."*
Ahora: *"Responde CONFIRMO para asegurar tu plaza — y si no puedes asistir, dímelo y te reagendamos sin problema 😊"*

## Fixes pendientes en la capa Python (VPS)

Los items #1, #2, #3, #10, #11, #12 viven en `agents/*.py` que corren en el VPS Python. **No los puedo redeployar desde esta capa** — requieren el equipo/owner del VPS. Instrucciones para el dev del VPS:

### `agents/agent_4_conversation.py:1280` (`_handle_negative`)
```python
# ANTES:
update_status(lead["id"], "lost")
send_goodbye_wa(lead)

# DESPUÉS:
update_status(lead["id"], "needs_human")
add_timeline_entry(lead["id"], "posible cierre — el lead usó palabra negativa; revisar antes de cerrar", kind="possible_close_detected")
# no goodbye WA — humano decide
```

### `agents/reschedule_flow.py:496-534` (`_handle_absent_interest_no`)
```python
# ANTES:
supabase.table("leads").update({"status": "lost"}).eq("id", lead_id).execute()
send_close_wa(...)

# DESPUÉS:
supabase.table("leads").update({"status": "needs_human"}).eq("id", lead_id).execute()
add_timeline_entry(lead_id, "lead respondió NO al absent-interest; revisar antes de cerrar", kind="absent_interest_no_pending_review")
```

### `agents/reschedule_flow.py:571-611` (`_cancel_class_and_notify_teacher`)
```python
# ELIMINAR el UPDATE classes SET status='cancelled'.
# Reemplazar por:
add_timeline_entry(lead_id, f"lead usó palabra 'cancelar' — revisar clase {class_id} y confirmar cancelación manual", kind="possible_cancel_detected", metadata={"class_id": class_id})
# opcional: enviar tarea al closer
```

Regex se mantiene solo como detector para NOTIFICAR, no para actuar.

## Backlog restante (MED)

- #4 `absent-interest-no` (email button): convertir en "confirmar cierre" step o retirar botón.
- #8 `post-trial-followups` msg 3 → `cold`: aceptable, pero considerar `needs_human`.
- #9 `diagnostico-followups` msg 8 → `lost`: valorar cambiar a `cold`.

## Cómo evitar recaídas

1. Cualquier PR nuevo con `.update({ status: "cancelled" | "lost" | "cold" | "trial_absent" | "no_show" })` en un cron o webhook requiere justificación humana en la descripción del PR + link a esta doc.
2. Regex de interpretación de mensajes del lead → siempre `fallback = "needs_human"`, nunca acción destructiva.
3. Grep-guard sugerido en pre-commit: `grep -rn "update.*status.*['\"]\\(lost\\|cold\\|cancelled\\)" web/app/api/cron/ web/app/api/webhooks/` — si hay match nuevo, warning.
4. Auditar semestral: repetir esta lista y verificar que ningún cron nuevo ha vuelto al patrón destructivo.
