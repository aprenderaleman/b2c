import { NextRequest, NextResponse } from "next/server";
import { listTrialSlots } from "@/lib/trial-slots";

/**
 * POST /api/internal/reschedule/check-availability
 *
 * Llamado por agents/reschedule_flow.py cuando un lead pide cambiar
 * la hora de su clase de prueba. Devuelve si el horario propuesto está
 * libre (con el profe original primero, luego cualquier profe del pool)
 * y, si no, una lista de hasta 5 alternativas cercanas.
 *
 * Body:
 *   {
 *     proposed_iso: "2026-05-08T17:00:00Z",     // hora pedida por el lead
 *     preferred_teacher_id: "uuid",              // profe original asignado
 *     class_id: "uuid"                            // clase de prueba a mover
 *                                                  (su slot actual NO se cuenta como ocupado)
 *   }
 *
 * Resp:
 *   {
 *     available: true,
 *     teacher_id: "uuid",                         // mismo profe si pudo, otro si no
 *     teacher_name: "Sabine Arning",
 *     start_iso: "2026-05-08T17:00:00.000Z"
 *   }
 *   | {
 *     available: false,
 *     alternatives: [
 *       { start_iso, teacher_id, teacher_name }, ...    // hasta 5
 *     ]
 *   }
 *
 * Auth: header x-internal-api-key debe coincidir con B2C_INTERNAL_API_KEY.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRIAL_DURATION_MIN = 40;
// Tolerancia ±15min: si el lead pide 17:00 y hay un slot a 16:45 lo
// consideramos "exacto" para no quemar al lead con "no hay" cuando
// hay un hueco a 15min de su petición.
const EXACT_TOLERANCE_MS = 15 * 60_000;
const MAX_ALTERNATIVES = 5;

export async function POST(req: NextRequest) {
  const expected = process.env.B2C_INTERNAL_API_KEY;
  if (!expected) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (req.headers.get("x-internal-api-key") !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { proposed_iso?: string; preferred_teacher_id?: string; class_id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!body.proposed_iso) {
    return NextResponse.json({ error: "proposed_iso_required" }, { status: 400 });
  }
  const proposedMs = Date.parse(body.proposed_iso);
  if (Number.isNaN(proposedMs)) {
    return NextResponse.json({ error: "invalid_iso" }, { status: 400 });
  }
  if (proposedMs < Date.now() + 4 * 3600_000) {
    // listTrialSlots ya filtra <4h pero damos error explícito para que
    // el agent pueda explicar al lead "muy pronto, intenta otra hora".
    return NextResponse.json({
      available: false,
      reason: "too_soon",
      alternatives: [],
    });
  }

  // listTrialSlots devuelve la lista completa ordenada cronológicamente.
  // No filtra por class_id ni teacher preferido — eso lo hacemos aquí.
  const slots = await listTrialSlots();

  // 1) ¿Hay slot exacto (±15min)?
  //    Preferimos el profe original si tiene slot dentro de la tolerancia,
  //    si no, cualquier otro profe.
  const inTolerance = slots.filter(s =>
    Math.abs(Date.parse(s.startIso) - proposedMs) <= EXACT_TOLERANCE_MS,
  );
  if (inTolerance.length > 0) {
    const preferred = body.preferred_teacher_id
      ? inTolerance.find(s => s.teacherId === body.preferred_teacher_id)
      : null;
    const winner = preferred ?? inTolerance[0];
    return NextResponse.json({
      available:    true,
      teacher_id:   winner.teacherId,
      teacher_name: winner.teacherName,
      start_iso:    winner.startIso,
      preferred_teacher_kept: Boolean(preferred),
    });
  }

  // 2) No hay slot — propon hasta 5 alternativas cercanas. Estrategia:
  //    los 3 más cercanos en el tiempo (antes y después) priorizando
  //    el profe original, hasta 2 del pool general.
  const sortedByProximity = [...slots].sort(
    (a, b) => Math.abs(Date.parse(a.startIso) - proposedMs)
            - Math.abs(Date.parse(b.startIso) - proposedMs),
  );
  const fromPreferred = body.preferred_teacher_id
    ? sortedByProximity.filter(s => s.teacherId === body.preferred_teacher_id).slice(0, 3)
    : [];
  const fromOthers = sortedByProximity
    .filter(s => !fromPreferred.find(p => p.startIso === s.startIso))
    .slice(0, MAX_ALTERNATIVES - fromPreferred.length);
  const alternatives = [...fromPreferred, ...fromOthers]
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
    .slice(0, MAX_ALTERNATIVES)
    .map(s => ({
      start_iso:    s.startIso,
      teacher_id:   s.teacherId,
      teacher_name: s.teacherName,
    }));

  return NextResponse.json({
    available: false,
    alternatives,
  });

  // Nota: TRIAL_DURATION_MIN está fijo en 40min — coincide con la
  // duración de los trials del funnel actual y con el cap implícito en
  // listTrialSlots. Si en el futuro varía, hay que pasarlo por body.
  void TRIAL_DURATION_MIN;
}
