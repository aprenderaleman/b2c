/**
 * /admin/ads — Dashboard de optimización del funnel.
 *
 * Tras la simplificación del funnel (2026-05-26) el embudo tiene 4
 * pasos: motivo → nivel → datos → trial. Las preguntas goal/urgencia/
 * budget eliminadas del UI las recoge Stiv por WhatsApp.
 *
 * Acceso: solo superadmin / admin.
 */
import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { getFunnelAdsData, TELEMETRY_STARTS_AT } from "@/lib/funnel-ads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funnel Ads · Admin" };

const RANGES: Array<{ label: string; days: number }> = [
  { label: "7 días",   days: 7   },
  { label: "30 días",  days: 30  },
  { label: "90 días",  days: 90  },
];

export default async function FunnelAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;
  const days = Number(sp.days ?? 30);
  const activeDays = RANGES.some(r => r.days === days) ? days : 30;

  const data = await getFunnelAdsData(activeDays);

  // ¿La ventana incluye días previos al lanzamiento de telemetría
  // granular? Si sí, advertir que paso 2 (nivel) puede tener datos
  // incompletos (en aquellos días no se persistía a funnel_progress).
  const telemetryDate = new Date(TELEMETRY_STARTS_AT);
  const cutoffDate = new Date(Date.now() - activeDays * 86_400_000);
  const partialTelemetry = cutoffDate < telemetryDate;

  // Conversión global paso 1 → paso 3 (formulario completado)
  const entry = data.steps[0]?.reached ?? 0;
  const formCompleted = data.steps[2]?.reached ?? 0;
  const trialBooked = data.steps[3]?.reached ?? 0;
  const overallFormConv = entry > 0 ? (100 * formCompleted / entry) : 0;
  const overallTrialConv = entry > 0 ? (100 * trialBooked / entry) : 0;

  return (
    <div className="px-5 md:px-8 py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">📊 Funnel Ads</h1>
          <p className="mt-1 text-sm text-white/60">
            Embudo de 4 pasos — motivo → nivel → datos → trial. Tras la simplificación del
            quiz (2026-05-26) Stiv recoge goal/urgencia por WhatsApp.
          </p>
        </div>
        <div className="flex gap-1.5 rounded-lg border border-white/10 bg-white/5 p-1">
          {RANGES.map(r => (
            <Link
              key={r.days}
              href={`/admin/ads?days=${r.days}`}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                r.days === activeDays
                  ? "bg-warm text-warm-foreground font-semibold"
                  : "text-white/70 hover:text-white"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs grandes — visión rápida del funnel */}
      <section className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Entradas (motivo)"
          value={entry.toLocaleString()}
          accent="text-white"
        />
        <KpiCard
          label="Form completado"
          value={`${formCompleted.toLocaleString()}`}
          subtitle={`${overallFormConv.toFixed(1)}% del paso 1`}
          accent={overallFormConv < 10 ? "text-red-300" : overallFormConv < 15 ? "text-amber-300" : "text-emerald-300"}
        />
        <KpiCard
          label="Trial agendada"
          value={`${trialBooked.toLocaleString()}`}
          subtitle={`${overallTrialConv.toFixed(1)}% del paso 1`}
          accent={trialBooked === 0 && formCompleted >= 5 ? "text-red-300" : overallTrialConv < 5 ? "text-amber-300" : "text-emerald-300"}
        />
        <KpiCard
          label="Convirtieron (pago)"
          value={`${data.motivoBreakdown.reduce((a, m) => a + m.converted, 0)}`}
          subtitle="status='converted'"
          accent="text-white"
        />
      </section>

      {partialTelemetry && (
        <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
          ℹ️ El paso 2 (nivel) sólo tiene telemetría desde el {TELEMETRY_STARTS_AT}. En
          rangos más largos los conteos del paso 2 pueden estar bajos
          artificialmente (los visitantes anteriores no quedaron registrados).
          Pasos 1, 3 y 4 son completos históricamente.
        </div>
      )}

      {/* ── Alertas ────────────────────────────────────────────── */}
      {data.alerts.length > 0 && (
        <section className="mt-6 space-y-2">
          {data.alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-xl border p-3 text-sm ${
                a.severity === "high"
                  ? "border-red-500/40 bg-red-500/10 text-red-100"
                  : a.severity === "medium"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                    : "border-blue-500/40 bg-blue-500/10 text-blue-100"
              }`}
            >
              <div className="font-semibold">
                {a.severity === "high" ? "🔴" : a.severity === "medium" ? "🟡" : "🔵"}{" "}
                {a.title}
              </div>
              <div className="mt-1 opacity-90">{a.detail}</div>
            </div>
          ))}
        </section>
      )}

      {/* ── Embudo de pasos ───────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-white">Embudo de 4 pasos</h2>
        <p className="mt-1 text-xs text-white/55">
          Cuántos visitantes llegan a cada paso vs. el paso anterior y vs. la entrada.
        </p>
        <div className="mt-3 space-y-2">
          {data.steps.map((s) => {
            const widthPct = s.pct_of_entry;
            const drop = s.drop_from_prev ?? 0;
            const dropColor = drop >= 50 ? "text-red-300" : drop >= 25 ? "text-amber-300" : "text-emerald-300";
            return (
              <div key={s.position} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-warm text-warm-foreground text-xs font-bold">
                      {s.position}
                    </span>
                    <span className="font-medium text-white">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-white/60">
                      {s.reached.toLocaleString()} {s.position <= 2 ? "sesiones" : "leads"}
                    </span>
                    {s.drop_from_prev !== null && (
                      <span className={dropColor}>
                        −{drop.toFixed(1)}% vs. anterior
                      </span>
                    )}
                    <span className="text-white/40 tabular-nums w-14 text-right">
                      {s.pct_of_entry.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-warm to-amber-300 rounded-full transition-all"
                    style={{ width: `${Math.max(2, widthPct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Respuestas más populares por paso ─────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-white">¿Qué eligen?</h2>
        <p className="mt-1 text-xs text-white/55">
          Distribución de respuestas en los pasos del quiz, y país de los leads que completan el formulario.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(pos => {
            const buckets = data.answers[pos] ?? [];
            const stepInfo = data.steps.find(s => s.position === pos);
            const customLabel = pos === 3 ? "País de leads que completan" : stepInfo?.label;
            const countLabel = pos === 3 ? "leads" : "respuestas";
            return (
              <div key={pos} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-wider text-white/50">
                  {pos === 3 ? "Paso 3" : `Paso ${pos}`}
                </div>
                <div className="text-sm font-semibold text-white mt-0.5">
                  {customLabel}
                </div>
                <div className="text-xs text-white/45 mt-1">
                  {(stepInfo?.reached ?? 0).toLocaleString()} {countLabel}
                </div>
                <div className="mt-3 space-y-1.5">
                  {buckets.length === 0 ? (
                    <div className="text-xs text-white/40 italic">
                      Sin datos en este rango.
                    </div>
                  ) : (
                    buckets.slice(0, 10).map(b => (
                      <div key={b.answer} className="text-[12px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/85 truncate flex-1" title={b.answer}>
                            {b.answer}
                          </span>
                          <span className="text-white/55 tabular-nums shrink-0">
                            {b.count} ({b.pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="mt-0.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full bg-warm/70"
                            style={{ width: `${b.pct}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Drop-off por motivo ───────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-white">Por motivo</h2>
        <p className="mt-1 text-xs text-white/55">
          Si un motivo tiene 0% en "datos", hay un problema específico de ese segmento —
          quizá la propuesta no encaja o el copy personalizado del paso 2 los espanta.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-white/50 border-b border-white/10">
              <tr>
                <th className="text-left py-2 pr-3">Motivo</th>
                <th className="text-right py-2 px-3">Sesiones</th>
                <th className="text-right py-2 px-3">→ Datos (form)</th>
                <th className="text-right py-2 px-3">→ Trial agendada</th>
                <th className="text-right py-2 pl-3">Convirtieron</th>
              </tr>
            </thead>
            <tbody>
              {data.motivoBreakdown.map(m => (
                <tr key={m.motivo} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-white font-medium">{m.motivo}</td>
                  <td className="py-2 px-3 text-right text-white/80 tabular-nums">{m.sessions}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    <span className={m.pct_datos < 5 ? "text-red-300" : m.pct_datos < 10 ? "text-amber-300" : "text-emerald-300"}>
                      {m.reached_datos} ({m.pct_datos.toFixed(1)}%)
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    <span className={m.pct_trial < 2 ? "text-red-300" : m.pct_trial < 5 ? "text-amber-300" : "text-emerald-300"}>
                      {m.reached_trial} ({m.pct_trial.toFixed(1)}%)
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right text-white/80 tabular-nums">{m.converted}</td>
                </tr>
              ))}
              {data.motivoBreakdown.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-white/40 italic">
                    Sin datos en este rango.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 text-center text-xs text-white/35">
        Datos en vivo. Quiz simplificado activado el {TELEMETRY_STARTS_AT}.
      </div>
    </div>
  );
}

function KpiCard({
  label, value, subtitle, accent,
}: {
  label:    string;
  value:    string;
  subtitle?: string;
  accent:   string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wider text-white/50">{label}</div>
      <div className={`mt-1 text-2xl md:text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
      {subtitle && <div className="text-xs text-white/45 mt-0.5">{subtitle}</div>}
    </div>
  );
}
