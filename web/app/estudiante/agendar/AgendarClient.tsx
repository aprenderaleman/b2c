"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * Selector de huecos para que el alumno agende o reagende su clase
 * (fase 3 — Gelfis 2026-10-06). Los huecos vienen de
 * GET /api/student/schedule (motor compartido con el funnel: 12h de
 * antelación, pausa de 10 min, bloqueos puntuales y GCal del profe).
 *
 * Modo reagenda: con `moveClassId` el POST va a
 * /api/student/schedule/[id] y mueve esa clase en vez de crear una.
 */

type Props = {
  moveClassId?:   string | null;
  moveClassInfo?: string | null;   // "jueves 9 de octubre · 17:00" (solo display)
};

const BERLIN = "Europe/Berlin";

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN }).format(new Date(iso));
}
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", timeZone: BERLIN,
  });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit", timeZone: BERLIN,
  });
}

export function AgendarClient({ moveClassId, moveClassInfo }: Props) {
  const [slots,       setSlots]       = useState<string[]>([]);
  const [teacherName, setTeacherName] = useState("tu profesor");
  const [disponibles, setDisponibles] = useState<number | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [sending,     setSending]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [done,        setDone]        = useState<string | null>(null);  // startIso confirmado

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/student/schedule");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(data?.message ?? "No pudimos cargar los horarios. Recarga la página.");
          return;
        }
        setSlots(data.slots ?? []);
        setTeacherName(data.teacherName ?? "tu profesor");
        setDisponibles(typeof data.disponibles === "number" ? data.disponibles : null);
      } catch {
        setLoadError("No pudimos cargar los horarios. Recarga la página.");
      } finally { setLoading(false); }
    })();
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) {
      const k = dayKey(s);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots]);
  const days = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  const activeDay = selectedDay ?? days[0] ?? null;

  const confirm = async () => {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    try {
      const url = moveClassId ? `/api/student/schedule/${moveClassId}` : "/api/student/schedule";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startIso: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "No se pudo completar. Inténtalo de nuevo.");
        if (data?.error === "slot_taken") {
          // refrescar huecos para que no re-elija el mismo
          const r2 = await fetch("/api/student/schedule");
          const d2 = await r2.json().catch(() => ({}));
          if (r2.ok) setSlots(d2.slots ?? []);
          setSelected(null);
        }
        return;
      }
      setDone(selected);
    } finally { setSending(false); }
  };

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400">Cargando horarios de {teacherName}…</p>;
  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;

  if (done) {
    return (
      <div className="rounded-3xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-6 text-center">
        <div className="text-4xl" aria-hidden>✅</div>
        <h2 className="mt-2 text-lg font-bold text-emerald-800 dark:text-emerald-200">
          {moveClassId ? "Clase reagendada" : "Clase agendada"}
        </h2>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300 capitalize">
          {dayLabel(done)} · {timeLabel(done)} (hora Berlín) con {teacherName}.
        </p>
        <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">
          Tu profesor ya recibió el aviso. Te llegará el recordatorio antes de la clase.
        </p>
        <Link href="/estudiante/clases" className="btn-primary mt-4 inline-flex">Ver mis clases</Link>
      </div>
    );
  }

  if (!moveClassId && disponibles !== null && disponibles <= 0) {
    return (
      <div className="rounded-3xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-5 text-sm text-amber-800 dark:text-amber-200">
        No te quedan clases disponibles para agendar en tu plan ahora mismo.
        Si crees que es un error, escríbenos por Mensajes.
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {teacherName} no tiene huecos libres en las próximas semanas.
        Escríbele por Mensajes para coordinar un horario.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {moveClassId && moveClassInfo && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
          Moviendo tu clase del <span className="font-semibold capitalize">{moveClassInfo}</span> — elige el nuevo horario:
        </div>
      )}
      {!moveClassId && disponibles !== null && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Puedes agendar {disponibles} {disponibles === 1 ? "clase" : "clases"} más con {teacherName}. Horarios en hora de Berlín.
        </p>
      )}

      {/* Selector de día */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {days.map(d => {
          const sample = byDay.get(d)![0];
          const active = d === activeDay;
          return (
            <button
              key={d}
              type="button"
              onClick={() => { setSelectedDay(d); setSelected(null); }}
              className={`shrink-0 rounded-2xl border px-3 py-2 text-xs font-semibold capitalize transition-colors
                ${active
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-brand-300"}`}
            >
              {new Date(sample).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: BERLIN })}
            </button>
          );
        })}
      </div>

      {/* Horas del día activo */}
      {activeDay && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {byDay.get(activeDay)!.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSelected(s)}
              className={`rounded-xl border px-2 py-2 text-sm font-mono transition-colors
                ${selected === s
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-brand-400"}`}
            >
              {timeLabel(s)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

      <button
        type="button"
        onClick={() => void confirm()}
        disabled={!selected || sending}
        className="btn-primary w-full sm:w-auto disabled:opacity-50"
      >
        {sending
          ? "Confirmando…"
          : selected
            ? `Confirmar ${moveClassId ? "nuevo horario" : "clase"}: ${timeLabel(selected)}`
            : "Elige un horario"}
      </button>
    </div>
  );
}
