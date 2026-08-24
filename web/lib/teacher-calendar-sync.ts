import { supabaseAdmin } from "./supabase";
import {
  createTeacherClassEvent,
  patchTeacherCalendarEvent,
  deleteTeacherCalendarEvent,
} from "./google-calendar-oauth";

/**
 * Espejo de clases en el Google Calendar personal del profe.
 *
 * Tres operaciones best-effort (nunca bloquean ni rompen el flujo de
 * clases): crear los eventos que falten, moverlos tras un reagendado,
 * y borrarlos tras una cancelación. Todas trabajan sobre listas de
 * class ids para cubrir series completas en una pasada.
 *
 * Además, si la clase es un trial con evento en el calendar CENTRAL de
 * Gelfis (google_calendar_event_id), el reagendado/cancelación también
 * actualiza ese espejo (patchTrialEvent / deleteTrialEvent).
 */

type ClassRow = {
  id:                        string;
  title:                     string;
  type:                      string;
  status:                    string;
  scheduled_at:              string;
  duration_minutes:          number;
  is_trial:                  boolean;
  teacher_id:                string | null;
  teacher_gcal_event_id:     string | null;
  google_calendar_event_id:  string | null;
};

async function loadClasses(classIds: string[]): Promise<ClassRow[]> {
  if (classIds.length === 0) return [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select("id, title, type, status, scheduled_at, duration_minutes, is_trial, teacher_id, teacher_gcal_event_id, google_calendar_event_id")
    .in("id", classIds);
  return (data ?? []) as ClassRow[];
}

/**
 * Crea el evento en el GCal del profe para cada clase agendada que aún
 * no tenga espejo. Si el profe no tiene GCal vinculado, create devuelve
 * null y no pasa nada.
 */
export async function mirrorClassesToTeacherCalendar(classIds: string[]): Promise<number> {
  const sb = supabaseAdmin();
  const rows = await loadClasses(classIds);
  let created = 0;
  for (const c of rows) {
    if (!c.teacher_id || c.teacher_gcal_event_id || c.status !== "scheduled") continue;
    const res = await createTeacherClassEvent(c.teacher_id, {
      summary:         c.title,
      startIso:        c.scheduled_at,
      durationMinutes: c.duration_minutes,
      description:     `Clase agendada en la plataforma Aprender-Aleman.de\nAula: https://b2c.aprender-aleman.de/aula/${c.id}`,
    });
    if (res) {
      await sb.from("classes").update({ teacher_gcal_event_id: res.eventId }).eq("id", c.id);
      created++;
    }
  }
  return created;
}

/**
 * Tras un reagendado (suelta o serie): mueve cada evento espejado a la
 * nueva hora de la clase; si el espejo no existía, lo crea. También
 * mueve el evento central del trial si lo hay.
 */
export async function syncTeacherCalendarAfterReschedule(classIds: string[]): Promise<void> {
  const sb = supabaseAdmin();
  const rows = await loadClasses(classIds);
  const toCreate: string[] = [];
  for (const c of rows) {
    if (!c.teacher_id) continue;
    if (c.teacher_gcal_event_id) {
      const ok = await patchTeacherCalendarEvent(
        c.teacher_id, c.teacher_gcal_event_id, c.scheduled_at, c.duration_minutes,
      );
      // Evento borrado a mano en Google → recrear
      if (!ok) {
        await sb.from("classes").update({ teacher_gcal_event_id: null }).eq("id", c.id);
        toCreate.push(c.id);
      }
    } else {
      toCreate.push(c.id);
    }

    if (c.google_calendar_event_id) {
      try {
        const { patchTrialEvent } = await import("./google-calendar");
        await patchTrialEvent(c.google_calendar_event_id, c.scheduled_at, c.duration_minutes);
      } catch (e) {
        console.warn(`[teacher-gcal-sync] central patch failed for ${c.id}:`, e);
      }
    }
  }
  if (toCreate.length > 0) await mirrorClassesToTeacherCalendar(toCreate);
}

/**
 * Tras una cancelación (suelta o serie): borra los eventos espejados
 * del GCal del profe y del calendar central, y limpia las columnas.
 */
export async function removeTeacherCalendarEvents(classIds: string[]): Promise<void> {
  const sb = supabaseAdmin();
  const rows = await loadClasses(classIds);
  for (const c of rows) {
    if (c.teacher_id && c.teacher_gcal_event_id) {
      await deleteTeacherCalendarEvent(c.teacher_id, c.teacher_gcal_event_id);
      await sb.from("classes").update({ teacher_gcal_event_id: null }).eq("id", c.id);
    }
    if (c.google_calendar_event_id) {
      try {
        const { deleteTrialEvent } = await import("./google-calendar");
        await deleteTrialEvent(c.google_calendar_event_id);
        await sb.from("classes").update({ google_calendar_event_id: null }).eq("id", c.id);
      } catch (e) {
        console.warn(`[teacher-gcal-sync] central delete failed for ${c.id}:`, e);
      }
    }
  }
}
