import type { EmpresaAlert } from "@/lib/empresa";

const SEVERITY_STYLES = {
  red:   "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-200",
  green: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200",
  amber: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200",
} as const;

const SEVERITY_ICONS = {
  red:   "!!",
  green: ">>",
  amber: "!",
} as const;

export function AlertBanner({ alerts }: { alerts: EmpresaAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-3">
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`rounded-2xl border p-4 ${SEVERITY_STYLES[a.severity]}`}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-sm font-bold shrink-0">
              {SEVERITY_ICONS[a.severity]}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-sm">{a.title}</p>
              <p className="text-xs mt-1 opacity-80">{a.detail}</p>
              <p className="text-xs mt-1 font-medium">{a.recommendation}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
