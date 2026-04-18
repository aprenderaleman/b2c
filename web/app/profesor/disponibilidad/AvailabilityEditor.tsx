"use client";

import { useState, useTransition } from "react";
import { DAY_LABELS_ES, WEEK_ORDER } from "@/lib/availability";

type Block = {
  day_of_week: number;
  start_time:  string;   // "HH:MM"
  end_time:    string;
  available:   boolean;
};

/**
 * Weekly availability editor. Data model is flat: a list of (day, start,
 * end) blocks. The UI groups them by day so the teacher can add / remove
 * blocks per day without needing to understand the model.
 *
 * Monday-first display order (WEEK_ORDER). Times in 15-min buckets.
 */
export function AvailabilityEditor({ initialBlocks }: { initialBlocks: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const byDay: Record<number, Block[]> = {};
  for (const d of [0,1,2,3,4,5,6]) byDay[d] = [];
  for (const b of blocks)          byDay[b.day_of_week].push(b);

  const addBlock = (day: number) => {
    setBlocks([...blocks, {
      day_of_week: day,
      start_time:  "09:00",
      end_time:    "12:00",
      available:   true,
    }]);
  };

  const removeBlock = (idx: number) => {
    setBlocks(blocks.filter((_, i) => i !== idx));
  };

  const updateBlock = (idx: number, patch: Partial<Block>) => {
    setBlocks(blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const save = () => {
    setError(null);
    setSavedAt(null);
    // Basic client-side validation.
    for (const b of blocks) {
      if (b.end_time <= b.start_time) {
        setError(`Hay un bloque inválido (${b.start_time}–${b.end_time}). La hora fin debe ser mayor.`);
        return;
      }
    }
    startTransition(async () => {
      const res = await fetch("/api/teacher/availability", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ blocks }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al guardar.");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
    });
  };

  return (
    <div className="space-y-4">
      {WEEK_ORDER.map(day => (
        <section key={day} className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
              {DAY_LABELS_ES[day]}
            </h3>
            <button
              type="button"
              onClick={() => addBlock(day)}
              className="text-xs font-medium rounded-full border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20"
            >
              + Añadir franja
            </button>
          </div>

          {byDay[day].length === 0 ? (
            <p className="mt-3 px-1 text-xs text-slate-500 dark:text-slate-400">
              Sin disponibilidad marcada.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {byDay[day].map((b, _idx) => {
                // Find the index in the flat blocks[] for mutation.
                const flatIdx = blocks.indexOf(b);
                return (
                  <li key={flatIdx} className="flex items-center gap-2 flex-wrap px-1">
                    <TimeInput
                      value={b.start_time}
                      onChange={(v) => updateBlock(flatIdx, { start_time: v })}
                    />
                    <span className="text-slate-400">–</span>
                    <TimeInput
                      value={b.end_time}
                      onChange={(v) => updateBlock(flatIdx, { end_time: v })}
                    />
                    <button
                      type="button"
                      onClick={() => removeBlock(flatIdx)}
                      className="ml-auto text-xs text-red-600 dark:text-red-400 hover:underline"
                    >
                      Eliminar
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {savedAt && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          Guardado a las {savedAt}.
        </p>
      )}

      <div className="flex items-center gap-3 sticky bottom-4">
        <button
          type="button"
          className="btn-primary"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      step={900}   // 15-minute buckets
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
    />
  );
}
