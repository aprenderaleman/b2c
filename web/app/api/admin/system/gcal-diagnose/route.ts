import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/admin/system/gcal-diagnose
 *
 * Diagnostic-only endpoint to figure out WHY createTrialEvent is
 * silently returning null in production. Walks the same code path
 * as the real client but reports each step's result so we can see
 * exactly which check fails:
 *
 *   1. ¿Existe la env GOOGLE_CALENDAR_ID?
 *   2. ¿Existe la env GOOGLE_SERVICE_ACCOUNT_JSON?
 *   3. ¿Parsea como JSON válido?
 *   4. ¿Tiene client_email y private_key?
 *   5. ¿La SA puede leer el calendar (events.list, no escribe nada)?
 *
 * Admin/superadmin gated — el JSON no expone la private_key, sólo
 * confirma su presencia y longitud.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const checks: Record<string, unknown> = {};

  // 1. Calendar ID env
  const calId = process.env.GOOGLE_CALENDAR_ID;
  checks.calendar_id_env_present = Boolean(calId);
  checks.calendar_id_value       = calId ? calId.slice(0, 40) : null;

  // 2. Service Account JSON env
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  checks.sa_json_env_present = Boolean(json);
  checks.sa_json_length      = json ? json.length : 0;
  checks.sa_json_starts_with = json ? json.slice(0, 30) : null;
  checks.sa_json_ends_with   = json ? json.slice(-30)   : null;

  if (!calId || !json) {
    return NextResponse.json({
      ok:        false,
      stopped_at: "env_vars",
      checks,
      hint: !calId
        ? "GOOGLE_CALENDAR_ID falta en Vercel. Ve a Settings → Environment Variables y añádela en Production + Preview + Development. Luego redeploy."
        : "GOOGLE_SERVICE_ACCOUNT_JSON falta en Vercel. Pega el contenido completo del archivo JSON de la Service Account.",
    }, { status: 200 });
  }

  // 3. JSON parse
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  checks.sa_json_parses    = Boolean(parsed);
  checks.sa_json_parse_err = parseError;

  if (!parsed) {
    return NextResponse.json({
      ok:        false,
      stopped_at: "json_parse",
      checks,
      hint: "El valor de GOOGLE_SERVICE_ACCOUNT_JSON en Vercel no es JSON válido. Esto suele pasar cuando se añaden comillas externas al pegar, o cuando el editor de texto que usaste corrompió el formato. Vuelve a copiar el archivo .json original COMPLETO (con sus llaves { } incluidas) y pégalo de nuevo en Vercel SIN comillas externas. Después redeploy.",
    }, { status: 200 });
  }

  // 4. Required SA fields
  const clientEmail  = (parsed as { client_email?: string }).client_email;
  const privateKey   = (parsed as { private_key?: string }).private_key;
  const projectId    = (parsed as { project_id?: string }).project_id;
  checks.sa_client_email   = clientEmail ? clientEmail : null;
  checks.sa_has_private_key = Boolean(privateKey);
  checks.sa_private_key_len = privateKey ? privateKey.length : 0;
  checks.sa_project_id      = projectId ? projectId : null;

  if (!clientEmail || !privateKey) {
    return NextResponse.json({
      ok:        false,
      stopped_at: "sa_fields",
      checks,
      hint: "El JSON parsea pero faltan client_email o private_key. Verifica que pegaste el archivo de Service Account, NO un JSON cualquiera.",
    }, { status: 200 });
  }

  // 5. Live check — try to read the calendar's metadata. Read-only,
  //    no escribe nada. Si falla con 403 → calendar no compartido.
  //    Si falla con 404 → calendar id mal.
  let liveCheck: Record<string, unknown> = { attempted: true };
  try {
    const { JWT } = await import("google-auth-library");
    const { calendar } = await import("@googleapis/calendar");
    const auth = new JWT({
      email: clientEmail,
      key:   privateKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });
    const cal = calendar({ version: "v3", auth });
    // El endpoint más barato: list 1 evento en los próximos 30 días.
    const r = await cal.events.list({
      calendarId: calId,
      maxResults: 1,
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      singleEvents: true,
    });
    liveCheck = {
      attempted: true,
      ok:        true,
      events_count_in_next_30d: (r.data.items ?? []).length,
      calendar_summary:         r.data.summary ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    liveCheck = {
      attempted: true,
      ok:        false,
      error:     msg,
      hint:
        msg.includes("403")    ? "La SA no tiene permiso. Vuelve a calendar.google.com → Settings de tu calendar → Share with specific people → verifica que el email "+clientEmail+" aparece con permiso 'Make changes to events'. Si aparece con 'See only free/busy' o 'See all event details', no basta — tiene que ser 'Make changes to events'."
        : msg.includes("404")    ? "Calendar no encontrado. Verifica que GOOGLE_CALENDAR_ID en Vercel es exactamente el Calendar ID que aparece en Settings del calendar (suele ser tu email aprenderaleman2026@gmail.com)."
        : msg.includes("invalid_grant") ? "Las credenciales JWT no validan contra Google. Probable que la private_key se haya truncado al pegar (por ejemplo, perdió saltos de línea internos). Re-copia el archivo JSON original COMPLETO."
        : "Error inesperado. Pega esto entero en el chat y lo desbloqueamos.",
    };
  }
  checks.live_check = liveCheck;

  const allGood = (liveCheck as { ok?: boolean }).ok === true;
  return NextResponse.json({
    ok:        allGood,
    stopped_at: allGood ? null : "live_check",
    checks,
    hint:      allGood ? "✅ Todo OK. La integración con Google Calendar funciona desde el lado server. Si las clases nuevas siguen sin aparecer en tu calendar, mira los logs runtime de Vercel filtrando por '[gcal]'." : (liveCheck as { hint?: string }).hint,
  });
}
