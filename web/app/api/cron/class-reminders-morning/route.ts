import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendClassMorningSummaryEmail } from "@/lib/email/send";

/**
 * GET/POST /api/cron/class-reminders-morning
 *
 * Una vez al día, ~8 AM Berlín, envía un EMAIL resumen a cada estudiante
 * y profesor con todas sus clases regulares (NO trials) del día.
 *
 * Vercel cron dispara a 06 y 07 UTC (cubre verano/invierno DST). El
 * endpoint se autoexcluye si la hora local Berlín no es 8.
 *
 * Filtros:
 *   - status='scheduled', is_trial=false (los trials los cubre otro cron)
 *   - usuarios con notifications_opt_out=false (=null cuenta como activo)
 *   - leads pausados via lead.ai_paused_until → no aplica aquí (los
 *     destinatarios son alumnos/profes registrados, no leads)
 *
 * Idempotencia: tras enviar, inserta una fila en `notifications` con
 * type='class_reminder_morning' y class_id = primera clase del día.
 * En el siguiente tick, si ya existe esa fila para HOY (Berlín) para
 * el user, skippea.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_TYPE = "class_reminder_morning";
const PLATFORM_URL  = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

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

  // DST guard — solo procesar si en Berlín son las 8.
  const url = new URL(req.url);
  if (url.searchParams.get("force") !== "1") {
    const berlinHour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hour: "numeric", hour12: false }).format(new Date()),
      10,
    );
    if (berlinHour !== 8) {
      return NextResponse.json({ ok: true, skipped: "dst_guard", berlin_hour: berlinHour });
    }
  }

  const sb = supabaseAdmin();

  // Hoy en Berlín — desde 00:00 hasta 23:59 local. Convertimos a UTC.
  const now = new Date();
  const berlinDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // Approx: Berlin midnight is UTC midnight ± offset. Hacemos de margen
  // ±2h para no perder nada por DST. El cap final es is_trial=false +
  // start hoy Berlín.
  const lowerUtc = new Date(`${berlinDateStr}T00:00:00+02:00`);     // CEST (verano)
  const upperUtc = new Date(`${berlinDateStr}T23:59:59+01:00`);     // CET máximo

  // Pull all non-trial scheduled classes today
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, title, teacher_id,
      teacher:teachers!inner(
        user_id,
        users!inner(email, full_name, language_preference, notifications_opt_out)
      ),
      class_participants(
        student_id,
        student:students!inner(
          user_id,
          users!inner(email, full_name, language_preference, notifications_opt_out)
        )
      )
    `)
    .eq("status", "scheduled")
    .eq("is_trial", false)
    .gte("scheduled_at", lowerUtc.toISOString())
    .lte("scheduled_at", upperUtc.toISOString());

  if (!classes || classes.length === 0) {
    return NextResponse.json({ ok: true, classesChecked: 0, emailsSent: 0 });
  }

  type UserRow = { email: string; full_name: string | null; language_preference: "es" | "de"; notifications_opt_out: boolean | null };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  // Filtro Berlín: solo classes cuya scheduled_at esté en EL MISMO Berlin-day
  // que `now`. Evitamos casos borderline tras la conversión bruta UTC.
  const todayBerlin = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
      === berlinDateStr;
  type Cls = { id: string; scheduled_at: string; duration_minutes: number; title: string; teacher_id: string;
               teacher: unknown; class_participants: unknown };
  const todayClasses = (classes as Cls[]).filter(c => todayBerlin(c.scheduled_at));

  // Build per-user buckets. clave = user_id
  type Bucket = {
    userId: string;
    email: string;
    name: string;
    lang: "es" | "de";
    audience: "student" | "teacher";
    optOut: boolean;
    classIds: string[];
    entries: Array<{ startTime: string; durationMin: number; title: string; partner: string; classUrl: string; classId: string }>;
  };
  const buckets = new Map<string, Bucket>();

  function add(bucketKey: string, b: Omit<Bucket, "entries" | "classIds"> & { entry: Bucket["entries"][number] }) {
    const cur = buckets.get(bucketKey) ?? {
      userId: b.userId, email: b.email, name: b.name, lang: b.lang,
      audience: b.audience, optOut: b.optOut, classIds: [], entries: [],
    };
    cur.entries.push(b.entry);
    cur.classIds.push(b.entry.classId);
    buckets.set(bucketKey, cur);
  }

  for (const c of todayClasses) {
    const teacherWrap = flat(c.teacher as { user_id: string; users: UserRow | UserRow[] } | Array<{ user_id: string; users: UserRow | UserRow[] }>);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    const startBerlin = new Date(c.scheduled_at).toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false });
    const classUrl = `${PLATFORM_URL}/aula/${c.id}`;

    type Part = { student_id: string; student: { user_id: string; users: UserRow | UserRow[] } | Array<{ user_id: string; users: UserRow | UserRow[] }> };
    const parts = (c.class_participants as Part[] | null) ?? [];
    const studentEntries = parts.map(p => {
      const sw = flat(p.student);
      const su = sw ? flat(sw.users) : null;
      return sw && su ? { userId: sw.user_id, email: su.email, name: su.full_name?.trim() || su.email, lang: su.language_preference, optOut: Boolean(su.notifications_opt_out) } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    // Bucket del profe
    if (teacherWrap && tu?.email) {
      const studentNames = studentEntries.map(s => s.name.split(/\s+/)[0]).join(", ") || "—";
      add(teacherWrap.user_id, {
        userId: teacherWrap.user_id, email: tu.email,
        name: (tu.full_name?.trim() || tu.email).split(/\s+/)[0],
        lang: tu.language_preference, audience: "teacher",
        optOut: Boolean(tu.notifications_opt_out),
        entry: { startTime: startBerlin, durationMin: c.duration_minutes, title: c.title, partner: studentNames, classUrl, classId: c.id },
      });
    }

    // Buckets de cada alumno
    for (const s of studentEntries) {
      const teacherName = (tu?.full_name?.trim() || tu?.email || "tu profesor/a").split(/\s+/)[0];
      add(s.userId, {
        userId: s.userId, email: s.email,
        name: s.name.split(/\s+/)[0],
        lang: s.lang, audience: "student",
        optOut: s.optOut,
        entry: { startTime: startBerlin, durationMin: c.duration_minutes, title: c.title, partner: teacherName, classUrl, classId: c.id },
      });
    }
  }

  // Send + dedup
  let sent = 0, skippedOptOut = 0, skippedDup = 0, failed = 0;
  for (const [userId, b] of buckets) {
    if (b.optOut) { skippedOptOut++; continue; }

    // Idempotency: ya existe notification de hoy para este user?
    const { data: existing } = await sb
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", REMINDER_TYPE)
      .gte("created_at", lowerUtc.toISOString())
      .limit(1);
    if (existing && existing.length > 0) { skippedDup++; continue; }

    // Sort entries by start time
    b.entries.sort((a, c) => a.startTime.localeCompare(c.startTime));

    const scheduleUrl = b.audience === "teacher"
      ? `${PLATFORM_URL}/profesor/clases`
      : `${PLATFORM_URL}/estudiante/clases`;

    const res = await sendClassMorningSummaryEmail(b.email, {
      audience:      b.audience,
      recipientName: b.name,
      classes:       b.entries.map(e => ({
        startTime:   e.startTime,
        durationMin: e.durationMin,
        title:       e.title,
        partner:     e.partner,
        classUrl:    e.classUrl,
      })),
      scheduleUrl,
      language:      b.lang,
    });

    if (res.ok) {
      sent++;
      // Dedup row — usamos la primera class_id del día como referencia.
      await sb.from("notifications").insert({
        user_id:  userId,
        type:     REMINDER_TYPE,
        title:    b.audience === "teacher" ? "Tus clases de hoy" : "Tienes clase hoy",
        body:     `${b.entries.length} clase${b.entries.length === 1 ? "" : "s"}`,
        link:     scheduleUrl,
        class_id: b.classIds[0],
      });
    } else {
      failed++;
      console.error(`[class-reminders-morning] send failed for ${b.email}: ${res.error}`);
    }
  }

  return NextResponse.json({
    ok: true,
    classesChecked: todayClasses.length,
    buckets: buckets.size,
    sent, skippedOptOut, skippedDup, failed,
  });
}
