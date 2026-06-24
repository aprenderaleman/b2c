import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getCalendarBusy } from "@/lib/google-calendar";

/**
 * GET /api/admin/leads/[id]/reschedule-trial/check?class_id=...&new_start_iso=...
 *
 * Devuelve advertencias (no bloquean) y colisiones (sí bloquean) para
 * que el modal de "Reagendar" muestre warnings antes del POST.
 *
 *   warnings: string[]  — texto humano para mostrar en amarillo
 *   collision: boolean  — true si hay otra clase del mismo profe a esa
 *                         hora (esto sí bloquea el confirm desde UI)
 *
 * Comprobaciones:
 *   1. Colisión con otra clase del mismo profesor (hard).
 *   2. Fuera de la ventana declarada en `teacher_availability`.
 *   3. Solapa con un evento ocupado del Google Calendar — solo cuando
 *      el email del profesor coincide con GOOGLE_CALENDAR_ID
 *      (mismo scope que el filter de slots públicos).
 *
 * Auth: session admin/superadmin.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const BERLIN_TZ = "Europe/Berlin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id: leadId } = await params;
  const url     = new URL(req.url);
  const classId = url.searchParams.get("class_id");
  const startIso = url.searchParams.get("new_start_iso");
  if (!classId || !startIso) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }
  const newStart = new Date(startIso);
  if (Number.isNaN(newStart.getTime())) {
    return NextResponse.json({ ok: false, error: "invalid_iso" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, status, is_trial, lead_id, teacher_id, duration_minutes,
      teacher:teachers!inner(user_id, users!inner(email))
    `)
    .eq("id", classId)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json({ ok: false, error: "class_not_found" }, { status: 404 });
  }
  type ClassRow = {
    id: string; status: string; is_trial: boolean; lead_id: string | null;
    teacher_id: string; duration_minutes: number;
    teacher: unknown;
  };
  const c = cls as ClassRow;
  if (c.lead_id !== leadId) {
    return NextResponse.json({ ok: false, error: "class_not_for_this_lead" }, { status: 409 });
  }

  // Email del profe (para filtro Google Calendar)
  const tFlat = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
  const u = (tFlat as { users?: unknown } | null)?.users;
  const uFlat = Array.isArray(u) ? u[0] : u;
  const teacherEmail = ((uFlat as { email?: string } | null)?.email ?? "").toLowerCase();

  const duration = c.duration_minutes ?? 30;
  const slotEnd  = new Date(newStart.getTime() + duration * 60_000);
  const warnings: string[] = [];

  // ── 1. Colisión con otra clase del mismo profe ─────────────────
  const { data: collisions } = await sb
    .from("classes")
    .select("id, title, scheduled_at")
    .eq("teacher_id", c.teacher_id)
    .in("status", ["scheduled", "live"])
    .neq("id", c.id)
    .lt("scheduled_at", slotEnd.toISOString())
    .gte("scheduled_at", new Date(newStart.getTime() - duration * 60_000).toISOString());
  const collision = !!collisions && collisions.length > 0;

  // ── 2. Disponibilidad declarada del profe ──────────────────────
  const dow = berlinDayOfWeek(newStart);
  const { data: avail } = await sb
    .from("teacher_availability")
    .select("day_of_week, start_time, end_time, available, valid_from, valid_until")
    .eq("teacher_id", c.teacher_id)
    .eq("day_of_week", dow)
    .eq("available", true);
  type Window = {
    day_of_week: number; start_time: string; end_time: string;
    valid_from: string | null; valid_until: string | null;
  };
  const dayKey = berlinDateKey(newStart);
  const validWindows = ((avail ?? []) as Window[])
    .filter(w => !w.valid_from  || dayKey >= w.valid_from)
    .filter(w => !w.valid_until || dayKey <= w.valid_until);

  // El nuevo slot debe encajar EN ALGUNA ventana — start ≥ winStart, end ≤ winEnd.
  const fitsInWindow = validWindows.some(w => {
    const winStart = berlinClockToUtcMs(newStart, w.start_time);
    const winEnd   = berlinClockToUtcMs(newStart, w.end_time);
    return newStart.getTime() >= winStart && slotEnd.getTime() <= winEnd;
  });
  if (validWindows.length === 0) {
    warnings.push(
      `El profesor no tiene disponibilidad declarada los ${weekdayLabel(dow)}.`,
    );
  } else if (!fitsInWindow) {
    const winsTxt = validWindows
      .map(w => `${w.start_time.slice(0,5)}-${w.end_time.slice(0,5)}`)
      .join(", ");
    warnings.push(
      `Fuera de la disponibilidad declarada (${weekdayLabel(dow)}: ${winsTxt}).`,
    );
  }

  // ── 3. Google Calendar busy ─────────────────────────────────────
  const gcalEmail = (process.env.GOOGLE_CALENDAR_ID ?? "").toLowerCase();
  if (gcalEmail && teacherEmail && teacherEmail === gcalEmail) {
    try {
      const busy = await getCalendarBusy(
        newStart.toISOString(),
        slotEnd.toISOString(),
      );
      const overlap = busy.some(b =>
        newStart.getTime() < b.endMs && slotEnd.getTime() > b.startMs);
      if (overlap) {
        warnings.push(
          "Ese horario solapa con un evento de tu Google Calendar.",
        );
      }
    } catch (e) {
      // Fail-open en consultas de calendario.
      console.warn("[reschedule-check] gcal busy lookup failed:", e);
    }
  }

  return NextResponse.json({
    ok:           true,
    collision,
    collision_with: collision
      ? (collisions ?? []).map(x => ({ id: x.id, title: x.title, scheduled_at: x.scheduled_at }))
      : [],
    warnings,
    inside_availability: fitsInWindow,
    has_availability_for_dow: validWindows.length > 0,
  });
}

// ── Helpers locales (TZ Berlín) — copia ligera de lib/trial-slots.ts.
//    Pequeños y autocontenidos; replicarlos evita exportarlos desde
//    un módulo grande ahora.

function berlinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function berlinDayOfWeek(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ, weekday: "short",
  });
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[fmt.format(d)] ?? 0;
}

function berlinClockToUtcMs(anchor: Date, hhmmss: string): number {
  const [hh, mm] = hhmmss.split(":").map(s => parseInt(s, 10));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(anchor);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  const offset = berlinOffsetMinutes(new Date(`${y}-${m}-${d}T12:00:00Z`));
  const sign = offset >= 0 ? "+" : "-";
  const oh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const om = String(Math.abs(offset) % 60).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00${sign}${oh}:${om}`).getTime();
}

function berlinOffsetMinutes(d: Date): number {
  const berlinNow = new Date(d.toLocaleString("en-US", { timeZone: BERLIN_TZ }));
  const utcNow    = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((berlinNow.getTime() - utcNow.getTime()) / 60_000);
}

function weekdayLabel(dow: number): string {
  return ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"][dow] ?? "?";
}
