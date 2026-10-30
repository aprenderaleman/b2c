import { supabaseAdmin } from "../supabase";
import { formatClassDateEs, formatClassTimeEs } from "../classes";
import { berlinClockToUtcMs, listTeacherClassSlots } from "../trial-slots";
import { findTeacherConflicts } from "../teacher-conflicts";
import { RESCHEDULE_CUTOFF_HOURS } from "../student-schedule";

/**
 * Mover varias clases sueltas de golpe (Gelfis 2026-10-30, caso Amina/Simon:
 * 21 clases = 21 tarjetas y 21 emails). El plan se calcula en servidor tanto
 * al proponer como al ejecutar: el cliente solo envía ids + hora, así que el
 * endpoint revalida todo y no puede imponer horarios que no pasen las reglas.
 */

export const MAX_MOVER = 60;

export type Actor =
  | { role: "admin" }
  | { role: "teacher"; teacherId: string }
  | { role: "student"; studentId: string };

export type Movimiento = { id: string; title: string; from: string; to: string; duration: number; students: string[] };
export type PlanMover =
  | { ok: true; teacherId: string; moves: Movimiento[] }
  | { ok: false; motivo: string };

const fmt = (iso: string) => `${formatClassDateEs(iso)} · ${formatClassTimeEs(iso)}`;

function berlinYmd(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(iso));
}
/** Misma fecha de Berlín + N días, a la hora de reloj pedida (estable al cambiar la hora). */
function target(iso: string, hora: string, dias: number): string {
  const anchor = new Date(`${berlinYmd(iso)}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + dias);
  return new Date(berlinClockToUtcMs(anchor, `${hora}:00`)).toISOString();
}

export async function planMover(
  actor: Actor,
  input: { classIds: string[]; hora: string; desplazarDias?: number },
): Promise<PlanMover> {
  const ids = [...new Set(input.classIds)];
  if (ids.length === 0) return { ok: false, motivo: "No hay clases que mover." };
  if (ids.length > MAX_MOVER) return { ok: false, motivo: `Máximo ${MAX_MOVER} clases de una vez.` };

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select("id, type, status, is_trial, teacher_id, scheduled_at, duration_minutes, title, class_participants(student_id)")
    .in("id", ids)
    .is("deleted_at", null);
  type Row = {
    id: string; type: string; status: string; is_trial: boolean; teacher_id: string | null;
    scheduled_at: string; duration_minutes: number; title: string;
    class_participants: Array<{ student_id: string }>;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length !== ids.length) return { ok: false, motivo: "Alguna de esas clases no existe." };

  const now = Date.now();
  for (const c of rows) {
    if (c.is_trial) return { ok: false, motivo: "Las clases de prueba no se mueven desde aquí." };
    if (c.status !== "scheduled") return { ok: false, motivo: `La clase del ${fmt(c.scheduled_at)} ya no está agendada.` };
    if (actor.role === "teacher" && c.teacher_id !== actor.teacherId) return { ok: false, motivo: "Alguna de esas clases no es tuya." };
    if (actor.role === "student") {
      if (!c.class_participants.some(p => p.student_id === actor.studentId)) return { ok: false, motivo: "Alguna de esas clases no es tuya." };
      if (c.type !== "individual") return { ok: false, motivo: "Las clases grupales las mueve tu profesor." };
      if ((new Date(c.scheduled_at).getTime() - now) / 3_600_000 < RESCHEDULE_CUTOFF_HOURS) {
        return { ok: false, motivo: `La clase del ${fmt(c.scheduled_at)} empieza en menos de ${RESCHEDULE_CUTOFF_HOURS} h: esa solo la puede mover tu profesor.` };
      }
    }
  }
  const teacherIds = new Set(rows.map(c => c.teacher_id));
  const teacherId = rows[0].teacher_id;
  if (teacherIds.size !== 1 || !teacherId) return { ok: false, motivo: "Todas las clases deben ser del mismo profesor." };

  const moves: Movimiento[] = rows.map(c => ({
    id: c.id, title: c.title, from: c.scheduled_at, duration: c.duration_minutes,
    to: target(c.scheduled_at, input.hora, input.desplazarDias ?? 0),
    students: c.class_participants.map(p => p.student_id),
  })).sort((a, b) => a.to.localeCompare(b.to));

  if (moves.every(m => new Date(m.to).getTime() === new Date(m.from).getTime())) {
    return { ok: false, motivo: "Esas clases ya están a esa hora." };
  }
  for (const m of moves) {
    if (new Date(m.to).getTime() <= now) return { ok: false, motivo: `El ${fmt(m.to)} ya pasó.` };
  }
  // Entre ellas (p. ej. una doble 18:00 + 18:50 no puede ir toda a las 20:30).
  for (let i = 1; i < moves.length; i++) {
    const prevEnd = new Date(moves[i - 1].to).getTime() + moves[i - 1].duration * 60_000;
    if (new Date(moves[i].to).getTime() < prevEnd) {
      return { ok: false, motivo: `Dos de esas clases quedarían pisadas el ${fmt(moves[i].to)}. ¿Son una clase doble? Hay que moverlas por separado.` };
    }
  }
  for (const m of moves) {
    const conflicts = await findTeacherConflicts(sb, {
      teacherId, startIso: m.to, durationMinutes: m.duration, excludeIds: ids, breakMinutes: 0,
    });
    if (conflicts.length > 0) {
      return { ok: false, motivo: `El ${fmt(m.to)} se pisa con otra clase del profesor (${fmt(conflicts[0].scheduled_at)}).` };
    }
  }
  // El alumno solo puede ir a huecos reales del motor; profe y admin como a mano.
  if (actor.role === "student") {
    const last = new Date(moves[moves.length - 1].to).getTime();
    const horizonDays = Math.ceil((last - now) / (24 * 3600_000)) + 1;
    const slots = await listTeacherClassSlots(teacherId, { excludeClassIds: ids, horizonDays });
    const free = new Set(slots.map(s => new Date(s.startIso).getTime()));
    for (const m of moves) {
      if (!free.has(new Date(m.to).getTime())) {
        return { ok: false, motivo: `El ${fmt(m.to)} no es un hueco libre de tu profesor.` };
      }
    }
  }
  return { ok: true, teacherId, moves };
}

/** Escribe el plan. Si algo falla a medias deja cada clase como estaba. */
export async function aplicarMover(moves: Movimiento[]): Promise<void> {
  const sb = supabaseAdmin();
  // El índice único (profe + hora exacta) mira cada UPDATE: orden que no pisa
  // el hueco de otra clase aún sin mover.
  const later = moves.some(m => m.to > m.from);
  const order = [...moves].sort((a, b) => later ? b.from.localeCompare(a.from) : a.from.localeCompare(b.from));
  const done: Movimiento[] = [];
  for (const m of order) {
    const { error } = await sb.from("classes").update({ scheduled_at: m.to }).eq("id", m.id).eq("status", "scheduled");
    if (error) {
      for (const d of done.reverse()) await sb.from("classes").update({ scheduled_at: d.from }).eq("id", d.id);
      throw new Error(error.message);
    }
    done.push(m);
  }
}
