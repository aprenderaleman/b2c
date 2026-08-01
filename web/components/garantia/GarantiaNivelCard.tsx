"use client";

type GarantiaStatus = "active" | "at_risk" | "lost" | "not_applicable";

export function GarantiaNivelCard({
  attendanceRate,
  schuleCompletionPct,
  status,
}: {
  attendanceRate: number | null;
  schuleCompletionPct: number | null;
  status: GarantiaStatus;
}) {
  if (status === "not_applicable") return null;

  const statusConfig = {
    active: {
      label: "Activa",
      color: "text-emerald-700 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-800",
      icon: "✅",
    },
    at_risk: {
      label: "En riesgo",
      color: "text-amber-700 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-amber-200 dark:border-amber-800",
      icon: "⚠️",
    },
    lost: {
      label: "Perdida",
      color: "text-red-700 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950/30",
      border: "border-red-200 dark:border-red-800",
      icon: "❌",
    },
  } as const;

  const cfg = statusConfig[status as keyof typeof statusConfig];
  if (!cfg) return null;

  return (
    <section className={`rounded-3xl border ${cfg.border} ${cfg.bg} p-5`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Estado de tu Garantia
        </h2>
        <span className={`text-sm font-semibold ${cfg.color}`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <MetricBar
          label="Asistencia"
          value={attendanceRate}
          threshold={80}
          suffix="%"
        />
        <MetricBar
          label="Ejercicios SCHULE"
          value={schuleCompletionPct}
          threshold={70}
          suffix="%"
          pending={schuleCompletionPct === null}
        />
      </div>

      {status === "at_risk" && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Mejora tu asistencia y completa los ejercicios para mantener tu garantia de nivel.
        </p>
      )}
    </section>
  );
}

function MetricBar({
  label,
  value,
  threshold,
  suffix,
  pending,
}: {
  label: string;
  value: number | null;
  threshold: number;
  suffix: string;
  pending?: boolean;
}) {
  if (pending) {
    return (
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-1 text-xs text-slate-400 dark:text-slate-500 italic">
          Pendiente de conexion
        </div>
      </div>
    );
  }

  const pct = value ?? 0;
  const isOk = pct >= threshold;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`text-sm font-semibold ${isOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {pct.toFixed(0)}{suffix}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isOk ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
        Minimo: {threshold}{suffix}
      </div>
    </div>
  );
}
