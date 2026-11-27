import type { GarantiaEvaluation } from "@/lib/garantia-rules";
import { ATTENDANCE_THRESHOLD, SCHULE_THRESHOLD, formatGarantiaPct } from "@/lib/garantia-rules";

/**
 * Tarjeta de la Garantía de Nivel con las reglas del contrato (2026-11-27):
 * asistencia ≥ 85 % y ejercicios de SCHULE al ritmo del curso (85 % al
 * terminar). La ven profes y admins; los alumnos, cuando se active
 * system_config.garantia_v2_alumnos. Sustituye a "Activa" con solo asistencia.
 */
export function GarantiaNivelCardV2({ view, audience }: { view: GarantiaEvaluation; audience: "staff" | "student" }) {
  if (view.status === "not_applicable") return null;

  const cfg = {
    active:  { label: view.programFinished ? "Cumple" : "Al día", icon: "✅", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800" },
    at_risk: { label: view.schuleUnknown && view.reasons.length === 1 ? "Sin verificar" : "En riesgo", icon: "⚠️", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800" },
    lost:    { label: "No cumple", icon: "❌", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800" },
  }[view.status];

  return (
    <section className={`rounded-3xl border ${cfg.border} ${cfg.bg} p-5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {audience === "student" ? "Estado de tu Garantía" : "Garantía de Nivel"}
        </h2>
        <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Bar label="Asistencia" value={view.attendanceRate} target={ATTENDANCE_THRESHOLD} note={`Mínimo: ${ATTENDANCE_THRESHOLD} %`} />
        <Bar
          label="Ejercicios de SCHULE"
          value={view.schulePct}
          target={view.expectedSchulePct ?? SCHULE_THRESHOLD}
          okFrom={view.expectedSchulePct === null ? 0 : Math.max(0, view.expectedSchulePct - 10)}
          note={view.schulePct === null
            ? "Sin datos todavía"
            : view.programFinished || view.expectedSchulePct === null
              ? `Al terminar el programa: ${SCHULE_THRESHOLD} %`
              : `A estas alturas: ~${view.expectedSchulePct} % · al terminar: ${SCHULE_THRESHOLD} %`}
        />
      </div>

      {view.reasons.length > 0 && (
        <ul className={`mt-3 space-y-1 text-xs ${view.status === "lost" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
          {view.reasons.map(r => <li key={r}>• {r}</li>)}
        </ul>
      )}
      {audience === "staff" && (
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
          La garantía se comprueba al terminar el programa: {ATTENDANCE_THRESHOLD} % de asistencia y {SCHULE_THRESHOLD} % de ejercicios de SCHULE.
          Los ejercicios se pueden poner al día hasta la última clase. El dato de SCHULE se actualiza una vez al día.
        </p>
      )}
    </section>
  );
}

function Bar({ label, value, target, okFrom, note }: { label: string; value: number | null; target: number; okFrom?: number; note: string }) {
  if (value === null) {
    return (
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-1 text-xs italic text-slate-400 dark:text-slate-500">{note}</div>
      </div>
    );
  }
  const ok = value >= (okFrom ?? target);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{formatGarantiaPct(value)} %</span>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, value)}%` }} />
        <div className="absolute top-0 h-full w-0.5 bg-slate-500/70 dark:bg-slate-300/70" style={{ left: `${Math.min(100, target)}%` }} aria-hidden />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{note}</div>
    </div>
  );
}
