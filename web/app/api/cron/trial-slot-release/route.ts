import { NextResponse } from "next/server";

/**
 * ⚠️ ENDPOINT ELIMINADO PERMANENTEMENTE — 2026-08-02.
 *
 * Este cron cancelaba trials sin confirmación en 12h y provocó
 * pérdida de leads que SÍ habían confirmado con palabras que el
 * regex no reconoció (e.g. "sí", "va", "ok", "de acuerdo"). La
 * solución NO es ajustar el umbral ni mejorar el regex — es
 * eliminar la automatización destructiva por completo.
 *
 * ═══════════════════════════════════════════════════════════════
 *  REGLA PERMANENTE DEL SISTEMA (Gelfis 2026-08-02)
 * ═══════════════════════════════════════════════════════════════
 *
 *  🚫 NINGÚN proceso automático cancela, libera ni reagenda
 *     clases de prueba.
 *
 *  Las únicas vías válidas de cancelación/reagenda son los
 *  botones de HUMANOS:
 *    - admin  → /admin/leads/[id] → "Reagendar" / "Cancelar"
 *    - profe  → /profesor/clasedeprueba → "Reagendar" / "Cancelar"
 *
 *  Cualquier automatismo futuro que quiera INFLUIR en el estado
 *  de una clase DEBE limitarse a NOTIFICAR a un humano (email a
 *  admin, badge en el CRM, entry en lead_timeline, tarea al
 *  closer). Nunca actuar.
 *
 *  Corolario: interpretar respuestas del lead (regex sobre WA
 *  entrante) para tomar acciones destructivas está PROHIBIDO. Si
 *  el regex no matchea → escalar a needs_human con la clase
 *  intacta. Ver también agents/reschedule_flow.py + auditoría
 *  docs/no-auto-cancel-policy.md.
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * Este endpoint queda para que cualquier cron histórico o llamada
 * externa devuelva 410 Gone. No se re-habilita bajo NINGUNA env.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const RESPONSE = {
  ok:     false,
  error:  "endpoint_removed_permanently",
  reason: "Ver comentario en route.ts. Regla del sistema 2026-08-02: ningún cron cancela clases.",
};

export async function GET()  { return NextResponse.json(RESPONSE, { status: 410 }); }
export async function POST() { return NextResponse.json(RESPONSE, { status: 410 }); }
