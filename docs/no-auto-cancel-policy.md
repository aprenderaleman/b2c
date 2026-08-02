# Política · No automated cancellations

**Fecha**: 2026-08-02.
**Origen**: incidente cron `trial-slot-release` que canceló ~14 trials
de leads que sí habían confirmado con palabras que el regex no
reconocía ("sí", "va", "ok", "de acuerdo"). Rescate manual.

---

## Regla

> **Ningún proceso automático cancela, libera, reagenda ni degrada el
> estado operativo de una clase de prueba.**

Solo humanos con contexto pueden tomar acciones destructivas sobre
`classes.status`, `leads.status` (cuando implica retirar oportunidad
comercial), o el calendario del profesor.

**Automatismos permitidos**: notificar, encolar, escalar,
seguimientos por WA/email, entries en `lead_timeline`, badges en el
CRM, tareas al closer. Cualquiera de estos es **notificar-no-actuar**.

## Vías legítimas de cancelación / reagenda

1. **Admin** → `/admin/leads/[id]` → botones `Cancelar` / `Reagendar` (delegan a `/api/trial-classes/[id]/cancel` y a `/api/teacher/trial/[leadId]/send-reschedule-link`).
2. **Profesor** → `/profesor/clasedeprueba` → mismos botones sobre su hub.
3. **Superadmin/backfill** → SQL directo con audit trail explícito (nunca en cron).

## Anti-patrones prohibidos

| Patrón | Ejemplo del incidente | Alternativa correcta |
|---|---|---|
| Cancelar clase basado en tiempo transcurrido | "12h sin CONFIRMO → liberar slot" | **Notificar al profe/admin**: "lead X no ha confirmado tras 12h" |
| Interpretar respuesta del lead con regex → acción destructiva | "usuario respondió con palabra no-reconocida → asumir NO → cerrar como lost" | **needs_human** con la clase intacta |
| Auto-marcar `absent` por hora | "trial ya pasó + no hubo evento en aula → marcar absent" | Notificar al profesor que confirme; nunca marcar por defecto |
| Cadenas (chain-engine) que cancelen pasos según respuesta | "chain3 detecta NO → close_lost" | Cambiar a "chain3 escalate_to_human" |

## Aplicación práctica

- Nuevos crons **NO** pueden llamar a `.update({ status: "cancelled" })` sobre `classes`, ni a `.update({ status: "lost"|"cold" })` sobre `leads` como consecuencia de un timer o de una respuesta del lead.
- Grep-guard sugerido en review: cualquier PR nuevo con `sb.from("classes").update({ status:` o `sb.from("leads").update({ status: "lost"` requiere justificación humana en la descripción.
- El regex de interpretar WhatsApp del lead (CONFIRMO/CAMBIAR/CANCELAR/etc.) es best-effort. **Fallback obligatorio**: si el regex no matchea → `needs_human`, clase intacta.

## Precedente eliminado

- `/api/cron/trial-slot-release/route.ts` — endpoint devuelve 410 Gone permanentemente. Ver comentario prominente en el file.
- Cron removido de `vercel.json` — no aparece en el planificador.

## Cambios de copy asociados

Mensaje de confirmación de trial (T+0 WhatsApp, cron `send-trial-notifications`) — eliminada la amenaza "sin tu respuesta en 12h tu slot se libera". Nuevo cierre:

> "Responde CONFIRMO para asegurar tu plaza — y si no puedes asistir, dímelo y te reagendamos sin problema 😊"

La confirmación **suma señal** (badge "confirmó ✓" en la ficha del profe, `leads.trial_confirmed_at` timestamp) pero nunca **resta clase**.

## Auditoría periódica

Ver `docs/audit-destructive-automations-2026-08.md` (adjunto tras la auditoría del punto 5). Re-auditar cada vez que se añada un cron nuevo bajo `web/app/api/cron/*` o cuando el agente Python `agents/*.py` cambie su lógica de interpretación.
