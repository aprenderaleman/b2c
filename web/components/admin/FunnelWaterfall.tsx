/**
 * Waterfall visualizer para /admin/funnel — sin librería, todo CSS.
 *
 * Cada paso es una barra horizontal con:
 *   - label + N sesiones
 *   - width proporcional al % de las entradas (step 10)
 *   - drop_from_prev en rojo si > 30%
 *
 * Server component: recibe data ya calculada por getWaterfall.
 */
import Link from "next/link";
import type { WaterfallData, LandingRow } from "@/lib/funnel-waterfall";

function qsAppend(base: string, patch: Record<string, string | number | undefined>): string {
  const [path, existing] = base.split("?");
  const sp = new URLSearchParams(existing ?? "");
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

export function FunnelWaterfall({
  data,
  device,
  currentUrl,
  landingIntent,
}: {
  data:           WaterfallData;
  device:         "all" | "mobile" | "desktop";
  currentUrl:     string;
  landingIntent?: string;
}) {
  const { steps, totalStart, windowDays } = data;

  return (
    <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">🌊 Waterfall del funnel</h2>
          <div className="text-[11px] text-white/45 mt-0.5">
            Landing → trial. {totalStart.toLocaleString()} sesiones únicas iniciaron en los últimos {windowDays}d
            {landingIntent && <> · landing <span className="font-mono">{landingIntent}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Device toggle */}
          <div className="flex rounded-md border border-white/10 overflow-hidden text-[11px]">
            {(["all", "desktop", "mobile"] as const).map(d => (
              <Link
                key={d}
                href={qsAppend(currentUrl, { wf_device: d === "all" ? undefined : d })}
                className={`px-2.5 py-1 font-medium ${
                  device === d
                    ? "bg-warm text-warm-foreground"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
              >
                {d === "all" ? "Todos" : d === "desktop" ? "🖥 Desktop" : "📱 Mobile"}
              </Link>
            ))}
          </div>
          <a
            href={`/api/admin/funnel-export?days=${windowDays}${landingIntent ? `&landing=${encodeURIComponent(landingIntent)}` : ""}`}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
          >
            📥 CSV
          </a>
        </div>
      </div>

      {totalStart === 0 ? (
        <div className="p-6 text-center text-white/40 italic text-sm">
          Sin datos en esta ventana. La instrumentación se activó el 2026-07-19; espera unas horas de tráfico.
        </div>
      ) : (
        <div className="p-3 space-y-1.5">
          {steps.map((s, idx) => {
            const widthPct = Math.max(2, s.pctOfStart); // mínimo 2% para que se vea
            const isTerminal  = idx === steps.length - 1;
            const dropLoud    = s.dropFromPrev !== null && s.dropFromPrev >= 30;
            const dropMedium  = s.dropFromPrev !== null && s.dropFromPrev >= 15 && s.dropFromPrev < 30;
            const barColor    = isTerminal
              ? "bg-emerald-500/40 border-emerald-400/60"
              : dropLoud
                ? "bg-red-500/25 border-red-400/50"
                : dropMedium
                  ? "bg-amber-500/25 border-amber-400/50"
                  : "bg-sky-500/25 border-sky-400/50";

            return (
              <div key={s.code} className="group relative">
                <div className="flex items-baseline justify-between gap-2 mb-0.5 text-[11.5px]">
                  <div className="text-white/85 font-medium truncate">{s.label}</div>
                  <div className="tabular-nums text-white/70 whitespace-nowrap">
                    <span className="font-semibold text-white">{s.sessions.toLocaleString()}</span>
                    <span className="text-white/40 ml-1.5">({s.pctOfStart.toFixed(1)}%)</span>
                    {s.dropFromPrev !== null && (
                      <span className={`ml-2 font-mono text-[10.5px] ${dropLoud ? "text-red-300" : dropMedium ? "text-amber-300" : "text-white/40"}`}>
                        {s.dropFromPrev > 0 ? "↓" : "→"} {s.dropFromPrev.toFixed(1)}%
                        {s.dropCountFromPrev !== null && s.dropCountFromPrev > 0 && (
                          <span className="text-white/35 ml-1">(-{s.dropCountFromPrev})</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-6 rounded-md bg-white/[0.02] border border-white/5 relative overflow-hidden">
                  <div
                    className={`h-full border-r ${barColor} transition-all`}
                    style={{ width: `${widthPct}%` }}
                  />
                  {dropLoud && idx > 0 && (
                    <Link
                      href={qsAppend(currentUrl, {
                        wf_drill: `${steps[idx - 1].code}-${s.code}`,
                      })}
                      className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] text-red-200 hover:text-white hover:bg-red-500/10 font-semibold"
                      title="Ver sesiones que abandonaron aquí"
                    >
                      🔎 investigar
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Comparador de landings — heatmap simple con conversión al final.
 */
export function LandingComparator({ rows }: { rows: LandingRow[] }) {
  if (rows.length === 0) return null;
  const maxBook = Math.max(...rows.map(r => r.bookPct), 1);

  return (
    <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white">🏆 Comparador por landing</h2>
        <div className="text-[11px] text-white/45 mt-0.5">
          Mismos hitos side-by-side. Ordenado por sesiones descendente.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10.5px] uppercase text-white/50 bg-white/5">
            <tr>
              <th className="text-left py-2 pl-4 pr-3">Landing</th>
              <th className="text-right py-2 px-3">Vistas</th>
              <th className="text-right py-2 px-3">CTA</th>
              <th className="text-right py-2 px-3">/agendar</th>
              <th className="text-right py-2 px-3">Slot picked</th>
              <th className="text-right py-2 px-3">Intento</th>
              <th className="text-right py-2 px-3">Trial ✓</th>
              <th className="text-right py-2 pr-4 pl-3">Conv.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map(r => {
              const heatIntensity = maxBook > 0 ? Math.round((r.bookPct / maxBook) * 100) : 0;
              return (
                <tr key={r.landingIntent} className="hover:bg-white/[0.03]">
                  <td className="py-2 pl-4 pr-3 font-mono text-[12px] text-white/85">{r.landingIntent}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-white/80">{r.step10}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-white/70">{r.step11}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-white/70">{r.step12}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-white/70">{r.step14}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-white/70">{r.step5}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-white/80">{r.step6}</td>
                  <td
                    className="py-2 pr-4 pl-3 text-right tabular-nums font-semibold"
                    style={{
                      backgroundColor: `rgba(52, 211, 153, ${heatIntensity / 200})`,
                      color: heatIntensity > 50 ? "#d1fae5" : "#e2e8f0",
                    }}
                  >
                    {r.bookPct.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Drill-down: lista de sesiones que llegaron a stepFrom pero no a stepTo.
 */
export function DropoffPanel({
  stepFromLabel,
  stepToLabel,
  sessions,
  closeUrl,
}: {
  stepFromLabel: string;
  stepToLabel:   string;
  sessions: Array<{
    sessionId:     string;
    reachedAt:     string;
    landingIntent: string | null;
    userAgent:     string | null;
  }>;
  closeUrl: string;
}) {
  return (
    <section className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.05] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-red-500/20 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-red-100">🔎 Drop-off: {stepFromLabel} → {stepToLabel}</h2>
          <div className="text-[11px] text-red-200/70 mt-0.5">
            {sessions.length} sesiones abandonaron aquí (máx 100 mostradas)
          </div>
        </div>
        <Link
          href={closeUrl}
          className="text-[11px] text-red-200 hover:text-white underline"
        >
          Cerrar
        </Link>
      </div>
      <div className="overflow-x-auto max-h-96">
        <table className="w-full text-[12px]">
          <thead className="text-[10.5px] uppercase text-red-200/70 bg-red-500/10 sticky top-0">
            <tr>
              <th className="text-left py-1.5 pl-4 pr-3">Sesión</th>
              <th className="text-left py-1.5 px-3">Landing</th>
              <th className="text-left py-1.5 px-3">Dispositivo</th>
              <th className="text-left py-1.5 pr-4 pl-3">Llegó a paso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-500/10">
            {sessions.map(s => {
              const isMobile = s.userAgent && /mobile|iphone|android|ipad/i.test(s.userAgent);
              return (
                <tr key={s.sessionId + s.reachedAt}>
                  <td className="py-1.5 pl-4 pr-3 font-mono text-white/70 text-[10.5px]">{s.sessionId.slice(0, 12)}…</td>
                  <td className="py-1.5 px-3 font-mono text-white/70">{s.landingIntent ?? "—"}</td>
                  <td className="py-1.5 px-3 text-white/70">{isMobile ? "📱 mobile" : "🖥 desktop"}</td>
                  <td className="py-1.5 pr-4 pl-3 text-white/60 tabular-nums">
                    {new Date(s.reachedAt).toLocaleString("es-ES", {
                      timeZone: "Europe/Berlin",
                      day: "2-digit", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                </tr>
              );
            })}
            {sessions.length === 0 && (
              <tr><td colSpan={4} className="py-3 text-center text-white/40 italic">Sin sesiones registradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
