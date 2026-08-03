# Mensajes WhatsApp — cadenas vs legacy · Autoridad por status

_Actualizado 2026-08-01. Fuente única para saber quién manda un mensaje ante cualquier acción._

## Regla general

Todos los mensajes conversacionales (multi-toque, con delay) se emiten desde el motor **`lead_chains`** (`web/lib/chain-engine.ts`). Solo mensajes **transaccionales** (respuesta inmediata a una acción del lead o del sistema, sin cadena posterior) viven en código legacy TS.

## Matriz por acción → cadena responsable

| Acción / evento | Handler | Cadena que arranca | Primer mensaje | Cierre |
|---|---|---|---|---|
| Lead agenda trial (self-serve) | `book-trial` | (ninguna) — envío 1-shot | `trial_confirmation` T+0 síncrono via `send-trial-notifications` | — |
| Lead reserva con depósito | Stripe webhook | (ninguna) | `priority_reserve_paid` T+0 síncrono | — |
| Profe pulsa "Asistió" (con pack) | `markTrialAttended` | `chain2_link_sent` | Enlace de pago T+0 (transaccional, envío inmediato desde handler ver nota abajo) | +48h → `en_reactivacion` +30d |
| Profe pulsa "Asistió" (sin pack) | `markTrialAttendedNoLink` | `chain1_attended` | T+2h step 1 | T+9d step 5 → `en_reactivacion` +30d |
| Profe pulsa "Asistió con objeción" | `markTrialAttendedWithObjection` | `chain3_obj_*` (según chip) | T+2h a T+24h step 1 | +5d → `en_reactivacion` +30d |
| Profe pulsa "No asistió" | `markTrialAbsent` | `chain4_absent` (variante deposit/nodeposit) | **T+20min step 1** | T+3d step 3 → `en_reactivacion` +30d |
| Lead responde CAMBIAR/CANCELAR | `reschedule_flow.py` | (ninguna) — 1-shot | `trial_reschedule_link` inmediato | (sin follow-up automático) |
| Profe pulsa "Reagendar" | `sendRescheduleLinkMessage` | (ninguna) — 1-shot + cron legacy `teacher-reschedule-followup` para FU +24h | `trial_reschedule_link` inmediato | FU2 +24h vía cron |
| Admin/profe cancela trial | `/api/trial-classes/[id]/cancel` | (ninguna) — 1-shot | `trial_cancelled` inmediato | — |
| Lead cierra `converted` (paga) | Stripe webhook + `lead-conversion` | `chain-engine.cancelActiveChain("payment_received")` | `welcome_student` T+0 síncrono | — |
| Lead diagnóstico sin agendar | `diagnostico-followups` cron | (ninguna — 6 mensajes escalonados propios del cron) | Msg #1 T+5min | Msg #8 T+14d → `lost` |
| Closer L2 arranca cadena manual | `/api/closer/leads/[id]/action` | `chain8a-g` según acción | Según definición | Según definición |

### Nota — enlace de pago (transaccional)

El envío del enlace de pago (`chain2_link_sent` sub_n=1) tiene un contrato especial: **envío inmediato garantizado** (síncrono o prioridad especial en el chain-processor). Es el único mensaje conversacional donde el lag del cron cuesta dinero.

## Legacy que quedó como 1-shot (justificado)

Estos crons/handlers siguen enviando WA fuera del motor de cadenas porque no tienen cadena aún o son 1-shot puros:

| Kind | Path | Justificación |
|---|---|---|
| `trial_confirmation` | `send-trial-notifications/route.ts` | T+0 síncrono tras booking. Idempotencia por `classes.notified_at`. |
| `trial_reminder_24h/morning/15m` | `trial-reminders-*/route.ts` | Recordatorios pre-clase, cron por hora. |
| `trial_teacher_reschedule_fu2` | `teacher-reschedule-followup/route.ts` | Único FU tras "Reagendar" del profe. Copy inline con `resolveChainVariables`. |
| `diagnostico_followup` msgs 1-8 | `diagnostico-followups/route.ts` | Nurture diagnóstico, cadena propia (no fue migrada). |
| `trial_cancelled` | `trial-classes/[id]/cancel/route.ts` | 1-shot al cancelar. |
| `welcome_student` | `lead-conversion.ts` | 1-shot al convertir. |
| `admin_manual` | `admin/wa-test` + otros admin | Uso manual desde panel. |

## Eliminado en la refactor 2026-08-01

Estos flows fueron **borrados** (no silenciados) porque duplicaban lo que ya cubren las chains:

- `/api/cron/post-trial-followups` — cubierto por `chain1_attended` (steps 2-5) y `chain3_obj_*`.
- `/api/cron/reschedule-followup` — reemplazado por copy inline (única FU T+24h) o por chain5_reschedule cuando se defina.
- `agent_5_guardian.tick_absent_followups` — cubierto por `chain4_absent`.
- `scheduler._notify_trials_30min` (Python) — cubierto por `trial-reminders-15m` TS.
- `trial-reminders-2h` — fusionado con morning.
- Envío inline en `markTrialAbsent` — ahora solo arranca `chain4_absent`.

## Cuando dudes

**¿Añadir un mensaje nuevo?** — primero mira si existe una cadena para ese status. Si sí, añade un step. Si no, decide: ¿es 1-shot transaccional? → cron legacy con copy inline. ¿Es conversacional? → crea o extiende una cadena y guarda el copy en `message_templates`.

**¿Cambiar un copy?** — si el kind empieza con `chain*` → edita en `/admin/mensajes` (BD). Si el kind es de la tabla "legacy 1-shot" → edita el `route.ts` correspondiente y respeta las `AUTHORING_RULES` de `message-catalog.ts`.
