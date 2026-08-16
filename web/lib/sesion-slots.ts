/**
 * Sesión de Plan — cálculo de slots según disponibilidad de CLOSERS.
 *
 * Gemelo de lib/trial-slots.ts con el mismo pipeline (pool → ventanas
 * semanales → restar ocupación → candidatos → round-robin) pero:
 *
 *   · Anfitrión: closers (users con role=closer, active, acepta_sesiones)
 *     — grifo independiente de flujo_activo (decisión Gelfis 2026-08-13).
 *   · Ventanas: closer_availability (migración 104).
 *   · Sesión de 20 min en grid :00/:30 hora Berlín — el colchón de
 *     10 min entre sesiones es deliberado (registrar en CRM + respirar),
 *     y las horas redondas reducen no-shows.
 *   · Lead-time mínimo 2h (los trials usan 4h): la sesión vende
 *     inmediatez — un lead caliente a las 10:00 agenda a las 12:00.
 *   · Ocupación: otras Sesiones de Plan del closer (classes con
 *     sesion_closer_id, status scheduled/live).
 *
 * Reutiliza los helpers de zona horaria Berlín de trial-slots.
 */

import { supabaseAdmin } from "./supabase";
import { berlinDayOfWeek, berlinClockToUtcMs, isWindowValid } from "./trial-slots";
import { getBusyForClosers } from "./closer-calendar-sync";

const DEFAULT_HORIZON_DAYS = 15;
const EXTENDED_HORIZON_DAYS = 30;

// Gelfis 2026-08-14: duración baja de 20 → 15 min (menos fricción para
// agendar; el closer usa los 15 min restantes del bloque :00/:30 como
// buffer entre sesiones). El grid de slots sigue en 30 min.
export const SESION_MINUTES = 15;
const GRID_MINUTES = 30;                 // slots en :00 y :30
const MIN_LEAD_TIME_HOURS = 2;
const MAX_RESULTS = 400;

export type SesionSlot = {
  startIso:   string;
  closerId:   string;   // users.id del closer anfitrión
  closerName: string;
};

type CloserRow = {
  id: string;
  full_name: string | null;
  email: string;
};

type BusyInterval = { startMs: number; endMs: number };

export async function listSesionSlots(): Promise<SesionSlot[]> {
  const slots = await computeSlots(DEFAULT_HORIZON_DAYS);
  if (slots.length > 0) return slots;
  return computeSlots(EXTENDED_HORIZON_DAYS);
}

async function computeSlots(horizonDays: number): Promise<SesionSlot[]> {
  const sb = supabaseAdmin();
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + horizonDays * 86_400_000);

  // ── 1. Pool de closers que aceptan sesiones ──
  const { data: closers } = await sb
    .from("users")
    .select("id, full_name, email")
    .eq("role", "closer")
    .eq("active", true)
    .eq("acepta_sesiones", true);

  const pool = (closers ?? []) as CloserRow[];
  if (pool.length === 0) return [];
  const poolIds = pool.map((c) => c.id);
  const nameById = new Map(pool.map((c) => [c.id, (c.full_name ?? c.email).split(/\s+/)[0]]));

  // ── 2. Carga de rotación (sesiones últimos 30 días) ──
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data: recent } = await sb
    .from("classes")
    .select("sesion_closer_id, scheduled_at")
    .in("sesion_closer_id", poolIds)
    .is("deleted_at", null)
    .in("status", ["scheduled", "live", "completed"])
    .gte("scheduled_at", since30d);

  const count30d = new Map<string, number>();
  const lastAt = new Map<string, string>();
  for (const r of (recent ?? []) as Array<{ sesion_closer_id: string; scheduled_at: string }>) {
    count30d.set(r.sesion_closer_id, (count30d.get(r.sesion_closer_id) ?? 0) + 1);
    const prev = lastAt.get(r.sesion_closer_id);
    if (!prev || r.scheduled_at > prev) lastAt.set(r.sesion_closer_id, r.scheduled_at);
  }

  // ── 3. Ventanas de disponibilidad + ocupación futura ──
  const [availRes, busyRes] = await Promise.all([
    sb
      .from("closer_availability")
      .select("closer_id, day_of_week, start_time, end_time, available, valid_from, valid_until")
      .in("closer_id", poolIds)
      .eq("available", true),
    sb
      .from("classes")
      .select("sesion_closer_id, scheduled_at, duration_minutes")
      .in("sesion_closer_id", poolIds)
      .is("deleted_at", null)
      .in("status", ["scheduled", "live"])
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", horizonEnd.toISOString()),
  ]);

  type Window = {
    closer_id: string; day_of_week: number;
    start_time: string; end_time: string;
    valid_from: string | null; valid_until: string | null;
  };
  const windows = (availRes.data ?? []) as Window[];
  if (windows.length === 0) return [];

  const busyByCloser = new Map<string, BusyInterval[]>();
  for (const b of (busyRes.data ?? []) as Array<{ sesion_closer_id: string; scheduled_at: string; duration_minutes: number | null }>) {
    const startMs = new Date(b.scheduled_at).getTime();
    const arr = busyByCloser.get(b.sesion_closer_id) ?? [];
    arr.push({ startMs, endMs: startMs + (b.duration_minutes ?? SESION_MINUTES) * 60_000 });
    busyByCloser.set(b.sesion_closer_id, arr);
  }

  // Añadir eventos externos del Google Calendar del closer (personal para
  // OAuth; shared SA para admin/Gelfis). Silent no-op si no vinculó calendar.
  // Cache de 60s dentro del dispatcher amortiza llamadas concurrentes del
  // slot picker.
  const externalBusy = await getBusyForClosers(
    poolIds,
    now.toISOString(),
    horizonEnd.toISOString(),
  );
  for (const [closerId, intervals] of externalBusy) {
    if (intervals.length === 0) continue;
    const arr = busyByCloser.get(closerId) ?? [];
    arr.push(...intervals);
    busyByCloser.set(closerId, arr);
  }

  // ── 4. Candidatos: grid :00/:30 hora Berlín dentro de cada ventana ──
  const minStartMs = now.getTime() + MIN_LEAD_TIME_HOURS * 3_600_000;
  type Candidate = { startMs: number; closerId: string };
  const candidates: Candidate[] = [];

  for (let i = 0; i < horizonDays; i++) {
    const dayDate = new Date(now.getTime() + i * 86_400_000);
    const dow = berlinDayOfWeek(dayDate);

    for (const w of windows) {
      if (w.day_of_week !== dow) continue;
      if (!isWindowValid(w, dayDate)) continue;

      const [sh, sm] = w.start_time.split(":").map((x) => parseInt(x, 10));
      const [eh, em] = w.end_time.split(":").map((x) => parseInt(x, 10));
      const winStartMin = sh * 60 + sm;
      const winEndMin = eh * 60 + em;

      // Alinear al siguiente :00/:30 del reloj de Berlín.
      let localMin = Math.ceil(winStartMin / GRID_MINUTES) * GRID_MINUTES;

      for (; localMin + SESION_MINUTES <= winEndMin; localMin += GRID_MINUTES) {
        const hh = String(Math.floor(localMin / 60)).padStart(2, "0");
        const mm = String(localMin % 60).padStart(2, "0");
        const t = berlinClockToUtcMs(dayDate, `${hh}:${mm}:00`);

        if (t < minStartMs) continue;

        const slotEnd = t + SESION_MINUTES * 60_000;
        const busy = busyByCloser.get(w.closer_id) ?? [];
        const collides = busy.some((b) => t < b.endMs && slotEnd > b.startMs);
        if (collides) continue;

        candidates.push({ startMs: t, closerId: w.closer_id });
      }
    }
  }

  // ── 5. Round-robin: un slot por timestamp, gana el closer con menos carga ──
  const byTime = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const arr = byTime.get(c.startMs) ?? [];
    arr.push(c);
    byTime.set(c.startMs, arr);
  }

  const times = [...byTime.keys()].sort((a, b) => a - b);
  const slots: SesionSlot[] = [];

  for (const t of times) {
    if (slots.length >= MAX_RESULTS) break;
    const contenders = byTime.get(t)!;
    contenders.sort((a, b) => {
      const ca = count30d.get(a.closerId) ?? 0;
      const cb = count30d.get(b.closerId) ?? 0;
      if (ca !== cb) return ca - cb;
      const la = lastAt.get(a.closerId) ?? "";
      const lb = lastAt.get(b.closerId) ?? "";
      if (la !== lb) return la.localeCompare(lb);
      return (nameById.get(a.closerId) ?? "").localeCompare(nameById.get(b.closerId) ?? "");
    });
    const winner = contenders[0];
    slots.push({
      startIso:   new Date(t).toISOString(),
      closerId:   winner.closerId,
      closerName: nameById.get(winner.closerId) ?? "Asesor",
    });
  }

  return slots;
}
