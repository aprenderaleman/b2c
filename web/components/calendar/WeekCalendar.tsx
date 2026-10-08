"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CreateClassModal } from "@/components/admin/CreateClassModal";

/**
 * Calendario semanal compartido teacher/closer (spec Gelfis 2026-08:
 * azul = recurrentes, naranja = trials, gris = pasadas; violeta =
 * sesiones de plan del closer). Grid construido a mano (no hay lib de
 * calendario en el proyecto), horas en Europa/Berlín.
 *
 * role="teacher": datos de /api/teacher/calendar, acciones completas
 * (reagendar / cancelar, sueltas y series) + botón "Agendar nueva clase".
 * role="closer": datos de /api/closer/calendar, solo lectura + contacto.
 */

type CalEvent = {
  id:               string;
  title:            string;
  type:             string;
  status:           string;
  scheduled_at:     string;
  duration_minutes: number;
  is_trial:         boolean;
  is_recurring:     boolean;
  parent_class_id:  string | null;
  recurrence_pattern: string | null;
  participants:     Array<{ studentId: string; name: string; whatsapp: string | null }>;
  lead:             { id: string; name: string | null; whatsapp: string | null } | null;
};

type AvailBand = { day_of_week: number; start_time: string; end_time: string };

type CalException = {
  id:         string;
  date:       string;   // YYYY-MM-DD (Berlín)
  start_time: string;   // HH:MM:SS
  end_time:   string;
  kind:       "bloqueo" | "apertura";
  reason:     string | null;
};

const HOUR_START = 7;
const HOUR_END   = 22;               // exclusive: grid muestra 07:00–22:00
const HOUR_PX    = 48;
const DAY_SHORT  = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// ── Berlin date helpers ────────────────────────────────────────────

function berlinDateStr(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year")?.value}-${p.find(x => x.type === "month")?.value}-${p.find(x => x.type === "day")?.value}`;
}

function berlinMinutes(iso: string): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(p.find(x => x.type === "hour")?.value ?? 0);
  const m = Number(p.find(x => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function berlinTimeStr(iso: string): string {
  const m = berlinMinutes(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** YYYY-MM-DD + n días (aritmética UTC sobre el string, sin tz). */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana del dateStr (Berlin calendar day). */
function mondayOf(dateStr: string): string {
  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();     // 0=Dom
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

function fmtDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function fmtRangeLabel(mon: string): string {
  const sun = addDays(mon, 6);
  const f = (s: string) => {
    const d = new Date(s + "T12:00:00Z");
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  return `${f(mon)} — ${f(sun)}`;
}

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

// ── Componente principal ───────────────────────────────────────────

export function WeekCalendar({ role }: { role: "teacher" | "closer" }) {
  const apiBase = role === "teacher" ? "/api/teacher/calendar" : "/api/closer/calendar";

  const [weekOffset, setWeekOffset] = useState(0);
  const [events, setEvents]         = useState<CalEvent[]>([]);
  const [bands, setBands]           = useState<AvailBand[]>([]);
  const [exceptions, setExceptions] = useState<CalException[]>([]);
  const [teacherId, setTeacherId]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selected, setSelected]     = useState<CalEvent | null>(null);
  const [exSelected, setExSelected] = useState<CalException | null>(null);
  const [slotPick, setSlotPick]     = useState<{ date: string; time: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<{ date: string; time: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const monday = useMemo(
    () => addDays(mondayOf(berlinDateStr(new Date())), weekOffset * 7),
    [weekOffset],
  );
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    // Ventana con margen ±1 día: los eventos se bucketizan client-side
    // por su día calendario en Berlín, así el desfase UTC no importa.
    const start = new Date(addDays(monday, -1) + "T00:00:00Z").toISOString();
    const end   = new Date(addDays(monday,  8) + "T00:00:00Z").toISOString();
    fetch(`${apiBase}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!live) return;
        if (!ok) { setError(data?.message ?? data?.error ?? "Error al cargar"); return; }
        setEvents(data.events ?? []);
        setBands(data.availability ?? []);
        setExceptions(data.exceptions ?? []);
        setTeacherId(data.teacherId ?? null);
      })
      .catch(e => { if (live) setError(String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [apiBase, monday, refreshKey]);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const d of days) map.set(d, []);
    for (const ev of events) {
      const key = berlinDateStr(new Date(ev.scheduled_at));
      map.get(key)?.push(ev);
    }
    return map;
  }, [events, days]);

  const now = Date.now();
  const todayStr = berlinDateStr(new Date());
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWeekOffset(o => o - 1)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-sm hover:border-brand-400" aria-label="Semana anterior">←</button>
          <button type="button" onClick={() => setWeekOffset(0)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm hover:border-brand-400">Hoy</button>
          <button type="button" onClick={() => setWeekOffset(o => o + 1)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-sm hover:border-brand-400" aria-label="Semana siguiente">→</button>
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmtRangeLabel(monday)}</span>
        {loading && <span className="text-xs text-slate-400">Cargando…</span>}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500 inline-block" /> Recurrente</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-orange-500 inline-block" /> Prueba</span>
          {role === "closer" && <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-violet-500 inline-block" /> Sesión</span>}
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-slate-400 inline-block" /> Pasada</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-200 dark:bg-emerald-500/30 inline-block" /> Disponible</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-red-300 dark:bg-red-500/40 inline-block" /> Bloqueado</span>
        </div>
        {role === "teacher" && (
          <button type="button" className="btn-primary text-sm" onClick={() => setCreateOpen(true)}>
            + Agendar nueva clase
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

      {/* Grid */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="min-w-[840px]">
          {/* Header row */}
          <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
            <div />
            {days.map(d => {
              const dow = new Date(d + "T12:00:00Z").getUTCDay();
              const isToday = d === todayStr;
              return (
                <div key={d} className={`px-2 py-2 text-center text-xs font-semibold border-l border-slate-100 dark:border-slate-800 ${isToday ? "text-brand-600 dark:text-brand-400" : "text-slate-600 dark:text-slate-300"}`}>
                  {fmtDayLabel(d)}
                  {isToday && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-500 align-middle" />}
                  <span className="sr-only">{DAY_SHORT[dow]}</span>
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
            {/* Hour gutter */}
            <div className="relative" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-slate-400" style={{ top: i * HOUR_PX }}>
                  {i > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
                </div>
              ))}
            </div>

            {days.map(d => {
              const dow = new Date(d + "T12:00:00Z").getUTCDay();
              const dayBands = bands.filter(b => b.day_of_week === dow);
              const dayEvents = byDay.get(d) ?? [];
              const dayExceptions = exceptions.filter(x => x.date === d);
              return (
                <div
                  key={d}
                  className="relative border-l border-slate-100 dark:border-slate-800"
                  style={{ height: hours.length * HOUR_PX }}
                  onClick={role === "teacher" ? (e) => {
                    // Click en hueco vacío → gestionar esa franja (Gelfis
                    // 2026-10-11). Los eventos/excepciones son <button>,
                    // así que si el click vino de uno, lo ignoramos aquí.
                    if ((e.target as HTMLElement).closest("button")) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const mins = HOUR_START * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60;
                    const snapped = Math.max(HOUR_START * 60, Math.min((HOUR_END - 1) * 60, Math.floor(mins / 30) * 30));
                    const time = `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
                    setSlotPick({ date: d, time });
                  } : undefined}
                >
                  {/* Hour lines */}
                  {hours.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800/70 pointer-events-none" style={{ top: i * HOUR_PX }} />
                  ))}
                  {/* Availability bands */}
                  {dayBands.map((b, i) => {
                    const s = toMin(b.start_time), e = toMin(b.end_time);
                    const { top, height } = pos(s, e);
                    if (height <= 0) return null;
                    return <div key={i} className="absolute inset-x-0 bg-emerald-100/70 dark:bg-emerald-500/10 pointer-events-none" style={{ top, height }} aria-hidden />;
                  })}
                  {/* Excepciones puntuales: bloqueos (rojo) y aperturas (verde fuerte) */}
                  {dayExceptions.map(x => {
                    const s = toMin(x.start_time), e = toMin(x.end_time);
                    const { top, height } = pos(s, e);
                    if (height <= 0) return null;
                    const isBlock = x.kind === "bloqueo";
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setExSelected(x)}
                        className={`absolute inset-x-0.5 rounded-md border px-1.5 py-0.5 text-left text-[10px] leading-tight overflow-hidden transition hover:ring-2 hover:ring-brand-400 ${
                          isBlock
                            ? "bg-red-100/90 dark:bg-red-500/20 border-red-300 dark:border-red-500/40 text-red-800 dark:text-red-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(239,68,68,0.12)_6px,rgba(239,68,68,0.12)_12px)]"
                            : "bg-emerald-200/80 dark:bg-emerald-500/25 border-emerald-400 dark:border-emerald-500/50 text-emerald-900 dark:text-emerald-200"}`}
                        style={{ top, height: Math.max(height, 18) }}
                        title={`${isBlock ? "Bloqueado" : "Franja extra"} ${x.start_time.slice(0, 5)}–${x.end_time.slice(0, 5)}${x.reason ? ` · ${x.reason}` : ""}`}
                      >
                        {isBlock ? "🚫" : "✅"} {x.start_time.slice(0, 5)}
                        {x.reason && <span className="ml-1 opacity-80">{x.reason}</span>}
                      </button>
                    );
                  })}
                  {/* Events */}
                  {dayEvents.map(ev => {
                    const s = berlinMinutes(ev.scheduled_at);
                    const e = s + ev.duration_minutes;
                    const { top, height } = pos(s, e);
                    const endTs = new Date(ev.scheduled_at).getTime() + ev.duration_minutes * 60_000;
                    const isPast = endTs < now || ev.status === "completed";
                    const color =
                      isPast          ? "bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600"
                      : ev.is_trial   ? "bg-orange-100 dark:bg-orange-500/20 text-orange-900 dark:text-orange-200 border-orange-400"
                      : ev.type === "sesion" ? "bg-violet-100 dark:bg-violet-500/20 text-violet-900 dark:text-violet-200 border-violet-400"
                      : "bg-blue-100 dark:bg-blue-500/20 text-blue-900 dark:text-blue-200 border-blue-400";
                    const who = ev.lead?.name ?? ev.participants.map(p => p.name.split(/\s+/)[0]).join(", ");
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => setSelected(ev)}
                        className={`absolute inset-x-0.5 rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight overflow-hidden shadow-sm hover:ring-2 hover:ring-brand-400 transition ${color}`}
                        style={{ top, height: Math.max(height, 22) }}
                        title={ev.title}
                      >
                        <span className="font-semibold">{berlinTimeStr(ev.scheduled_at)}</span>
                        {ev.is_recurring && <span aria-label="recurrente" title="Serie recurrente"> ↻</span>}
                        {ev.status === "live" && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse align-middle" />}
                        <br />
                        <span className="line-clamp-2">{who || ev.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <EventModal
          ev={selected}
          role={role}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); refresh(); }}
        />
      )}

      {exSelected && (
        <ExceptionModal
          ex={exSelected}
          teacherId={teacherId}
          canEdit={role === "teacher"}
          onClose={() => setExSelected(null)}
          onChanged={() => { setExSelected(null); refresh(); }}
        />
      )}

      {slotPick && role === "teacher" && (
        <SlotModal
          pick={slotPick}
          teacherId={teacherId}
          onClose={() => setSlotPick(null)}
          onSchedule={() => { setCreatePrefill(slotPick); setSlotPick(null); }}
          onChanged={() => { setSlotPick(null); refresh(); }}
        />
      )}

      {role === "teacher" && (
        <CreateClassModal
          open={createOpen || createPrefill !== null}
          mode="teacher"
          initialDate={createPrefill?.date}
          initialTime={createPrefill?.time}
          onClose={() => { setCreateOpen(false); setCreatePrefill(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Modal de un hueco vacío: agendar clase o bloquear/abrir franja ──

function SlotModal({
  pick, teacherId, onClose, onSchedule, onChanged,
}: {
  pick: { date: string; time: string };
  teacherId: string | null;
  onClose: () => void;
  onSchedule: () => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dayLabel = new Date(pick.date + "T12:00:00Z").toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
  const plus50 = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const total = h * 60 + m + 50;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const addException = (kind: "bloqueo" | "apertura") => {
    setError(null);
    start(async () => {
      const qs = teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : "";
      const res = await fetch(`/api/teacher/availability/exceptions${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: pick.date, start_time: pick.time, end_time: plus50(pick.time), kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.message ?? data?.error ?? "No se pudo guardar."); return; }
      onChanged();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-white capitalize">
          {dayLabel} · {pick.time}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">¿Qué quieres hacer con esta franja? (50 min, hora Berlín)</p>
        <div className="grid gap-2">
          <button type="button" className="btn-primary text-sm w-full" onClick={onSchedule} disabled={pending}>
            ➕ Agendar clase aquí
          </button>
          <button type="button" onClick={() => addException("bloqueo")} disabled={pending}
            className="w-full rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-500/20">
            🚫 Bloquear esta franja ({pick.time}–{plus50(pick.time)})
          </button>
          <button type="button" onClick={() => addException("apertura")} disabled={pending}
            className="w-full rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-2 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-500/20">
            ✅ Abrir franja extra solo este día
          </button>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
        <div className="flex justify-end">
          <button type="button" className="btn-secondary text-xs" onClick={onClose} disabled={pending}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de una excepción existente: ver + eliminar ───────────────

function ExceptionModal({
  ex, teacherId, canEdit, onClose, onChanged,
}: {
  ex: CalException;
  teacherId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isBlock = ex.kind === "bloqueo";

  const dayLabel = new Date(ex.date + "T12:00:00Z").toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });

  const remove = () => {
    setError(null);
    start(async () => {
      const qs = teacherId ? `&teacherId=${encodeURIComponent(teacherId)}` : "";
      const res = await fetch(`/api/teacher/availability/exceptions?id=${encodeURIComponent(ex.id)}${qs}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.message ?? data?.error ?? "No se pudo eliminar."); return; }
      onChanged();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          {isBlock ? "🚫 Franja bloqueada" : "✅ Franja extra abierta"}
        </h2>
        <p className="text-sm text-slate-700 dark:text-slate-200 capitalize">
          {dayLabel} · <span className="font-mono">{ex.start_time.slice(0, 5)}–{ex.end_time.slice(0, 5)}</span> (Berlín)
          {ex.reason && <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400 normal-case">Motivo: {ex.reason}</span>}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isBlock
            ? "Este hueco no se ofrece para clases de prueba ni agendados. Solo aplica a esta fecha."
            : "Este hueco se ofrece SOLO esta fecha — no se repite semanalmente."}
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={onClose} disabled={pending}>Cerrar</button>
          {canEdit && (
            <button type="button" onClick={remove} disabled={pending}
              className="rounded-full bg-red-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-red-700">
              {pending ? "…" : "Eliminar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function pos(startMin: number, endMin: number): { top: number; height: number } {
  const base = HOUR_START * 60;
  const top = Math.max(0, (startMin - base) / 60 * HOUR_PX);
  const bottom = Math.min((HOUR_END - HOUR_START) * HOUR_PX, (endMin - base) / 60 * HOUR_PX);
  return { top, height: bottom - top };
}

// ── Modal de detalle + acciones ────────────────────────────────────

function EventModal({
  ev, role, onClose, onChanged,
}: {
  ev: CalEvent;
  role: "teacher" | "closer";
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Reschedule form
  const [dateStr, setDateStr] = useState(berlinDateStr(new Date(ev.scheduled_at)));
  const [timeStr, setTimeStr] = useState(berlinTimeStr(ev.scheduled_at));
  const [dur, setDur]         = useState(ev.duration_minutes);
  const [scope, setScope]     = useState<"this" | "series">("this");

  const canEdit = role === "teacher" && ev.status === "scheduled";
  const when = new Date(ev.scheduled_at).toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  const doReschedule = () => {
    setError(null);
    if (!dateStr || !timeStr) { setError("Indica fecha y hora."); return; }
    // Berlin local → UTC ISO (navegador de profes/Gelfis en Berlín,
    // mismo criterio que ClassActions).
    const iso = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    start(async () => {
      const res = await fetch(`/api/teacher/classes/${ev.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ scope, scheduledAt: iso, durationMinutes: dur }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.message ?? data?.error ?? "No se pudo guardar."); return; }
      onChanged();
    });
  };

  const doCancel = (cancelScope: "this" | "series") => {
    start(async () => {
      const res = await fetch(`/api/teacher/classes/${ev.id}?scope=${cancelScope}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data?.message ?? data?.error ?? "No se pudo cancelar."); return; }
      onChanged();
    });
  };

  const contacts: Array<{ name: string; whatsapp: string | null }> =
    ev.lead ? [{ name: ev.lead.name ?? "Lead", whatsapp: ev.lead.whatsapp }]
            : ev.participants.map(p => ({ name: p.name, whatsapp: p.whatsapp }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{ev.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 capitalize">
              {when} (Berlín) · {ev.duration_minutes} min
              {ev.is_recurring && " · serie recurrente ↻"}
              {ev.is_trial && " · clase de prueba"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </header>

        <div className="px-5 py-4 space-y-4 text-sm">
          {contacts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                {ev.lead ? "Lead" : contacts.length > 1 ? "Estudiantes" : "Estudiante"}
              </p>
              <ul className="space-y-1">
                {contacts.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="text-slate-700 dark:text-slate-200">{c.name}</span>
                    {c.whatsapp && (
                      <a href={waLink(c.whatsapp)} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
                        WhatsApp ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mode === "view" && (
            <div className="flex flex-wrap gap-2">
              <a href={`/aula/${ev.id}`} className="btn-secondary text-xs">Entrar al aula</a>
              {role === "teacher" && !ev.is_trial && (
                <>
                  <a href={`/profesor/clases/${ev.id}`} className="btn-secondary text-xs">Ver detalle</a>
                  <a href="/profesor/mensajes" className="btn-secondary text-xs">💬 Mensajes</a>
                </>
              )}
              {canEdit && (
                <>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setMode("reschedule")}>
                    Reagendar
                  </button>
                  <button type="button" onClick={() => setMode("cancel")}
                    className="rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-500/20">
                    Cancelar clase
                  </button>
                </>
              )}
            </div>
          )}

          {mode === "reschedule" && (
            <div className="space-y-3">
              {ev.is_recurring && (
                <div className="flex gap-2">
                  <label className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-xs ${scope === "this" ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 font-semibold" : "border-slate-200 dark:border-slate-700"}`}>
                    <input type="radio" className="sr-only" checked={scope === "this"} onChange={() => setScope("this")} />
                    Solo esta clase
                  </label>
                  <label className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-xs ${scope === "series" ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 font-semibold" : "border-slate-200 dark:border-slate-700"}`}>
                    <input type="radio" className="sr-only" checked={scope === "series"} onChange={() => setScope("series")} />
                    Esta y todas las siguientes
                  </label>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Fecha (Berlín)</span>
                  <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="mt-1 input-text w-full" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Hora (Berlín)</span>
                  <input type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)} className="mt-1 input-text w-full" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Duración</span>
                <select value={dur} onChange={e => setDur(Number(e.target.value))} className="mt-1 input-text w-full">
                  {[30, 45, 60, 75, 90, 105, 120].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </label>
              {scope === "series" && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  El cambio de horario se aplica como desplazamiento a cada clase futura de la serie (se mantiene el espaciado). Se avisará al alumno.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => setMode("view")} disabled={pending}>Volver</button>
                <button type="button" className="btn-primary text-xs" onClick={doReschedule} disabled={pending}>
                  {pending ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          )}

          {mode === "cancel" && (
            <div className="space-y-3">
              <p className="text-slate-700 dark:text-slate-200">
                ¿Cancelar {ev.is_recurring ? "solo esta clase o toda la serie" : "esta clase"}? Se avisará al alumno por email y notificación.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => setMode("view")} disabled={pending}>Volver</button>
                <button type="button" onClick={() => doCancel("this")} disabled={pending}
                  className="rounded-full border border-red-300 text-red-700 dark:text-red-300 px-3 py-1.5 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-500/10">
                  {pending ? "…" : "Solo esta clase"}
                </button>
                {ev.is_recurring && (
                  <button type="button" onClick={() => doCancel("series")} disabled={pending}
                    className="rounded-full bg-red-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-red-700">
                    {pending ? "…" : "Toda la serie"}
                  </button>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
