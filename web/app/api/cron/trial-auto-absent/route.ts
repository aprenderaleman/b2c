import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { markTrialAbsent } from "@/lib/admin-actions";

/**
 * GET/POST /api/cron/trial-auto-absent
 *
 * Vercel Cron diario que CIERRA automáticamente las clases de prueba
 * "huérfanas" — clases con `scheduled_at + grace_window < now()` que
 * nadie marcó como `trial_attended` ni `trial_absent` desde admin.
 *
 * Por qué existe (Gelfis 2026-06-15):
 *   El KPI de asistencia del dashboard /admin/ads se hacía irreal con
 *   leads "pending" que en realidad nunca asistieron — clases pasadas
 *   sin marcar. Si el profe olvida marcar absent, ese lead se queda en
 *   limbo y distorsiona la tasa. Este cron asume "no marcado = no
 *   asistió" pasadas N horas, lo cual es la realidad operativa.
 *
 * Ventana de gracia: 24h después de scheduled_at. Esto da tiempo al
 * profe de marcar manualmente (caso común: marca al día siguiente).
 *
 * Idempotencia: filtramos `trial_attended_at IS NULL AND trial_absent_at IS NULL`,
 * el propio update salta los ya marcados.
 *
 * Acción: setea `leads.status='trial_absent'`, `trial_absent_at=now()`,
 * inserta marker en lead_timeline para auditoría.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const GRACE_HOURS = 24;

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString();

  // Leads cuya última clase de prueba agendada ya pasó hace >24h y
  // siguen sin marcar como attended/absent. Filtramos por
  // trial_scheduled_at (timestamp del lead) para alinear con el resto
  // del dashboard, que cuenta el funnel desde ese campo.
  //
  // Excluimos:
  //   - status='converted' (ya pagó, no nos importa la asistencia)
  //   - status='lost' (drip los marcó cerrados)
  //   - status='trial_attended' (ya marcado, defensivo)
  //   - status='trial_absent' (ya marcado, defensivo)
  const { data: candidates, error } = await sb
    .from("leads")
    .select("id, trial_scheduled_at, status")
    .lt("trial_scheduled_at", cutoff)
    .is("trial_attended_at", null)
    .is("trial_absent_at", null)
    .not("status", "in", "(converted,lost,trial_attended,trial_absent)")
    .limit(500);

  if (error) {
    console.error("[cron/trial-auto-absent] select failed:", error);
    return NextResponse.json({ error: "select_failed", detail: error.message }, { status: 500 });
  }

  const rows = candidates ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, marked: 0, scanned: 0 });
  }

  const ids = rows.map(r => r.id);

  // Fix Gelfis 2026-07-24: en vez de un UPDATE masivo silencioso que
  // dejaba huérfano el flow absent-interest, iteramos y llamamos a
  // markTrialAbsent por cada lead — misma ruta que el botón del
  // profesor. Envía WA + email con SÍ/NO y setea AWAITING_ABSENT_INTEREST.
  //
  // Riesgo mitigado: en runs normales aquí caen 0-5 leads del día
  // anterior, no un burst. sendWhatsappText tiene rate-limit 15s.
  let succeeded = 0, failed = 0;
  for (const id of ids) {
    try {
      await markTrialAbsent(id);
      succeeded++;
    } catch (e) {
      failed++;
      console.error(`[cron/trial-auto-absent] markTrialAbsent failed for ${id}:`, e);
    }
  }

  return NextResponse.json({ ok: true, marked: succeeded, failed, scanned: rows.length });
}
