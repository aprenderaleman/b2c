/**
 * /admin/funnel — Command center unificado.
 *
 * Combina lo mejor de /admin/ads (KPIs + atribución del funnel) con
 * lo mejor de /admin/leads (lista de leads recientes para acción).
 * Decisión Gelfis 2026-06-15: una sola página para onboarding de
 * nuevos operadores + mobile-friendly de un vistazo.
 *
 * Sección 1 — KPIs:
 *   - Entradas / Form completado / Trial agendada / Tasa asistencia / Convirtieron
 *   - Filtros: rango de fechas + país
 *   - Datos honestos: usa leads.trial_attended_at / trial_absent_at
 *     (migration 063) y motivo_inicial='direct' para atajos.
 *
 * Sección 2 — Leads recientes:
 *   - Top 50 ordenados por updated_at DESC (los más recientes arriba)
 *   - Solo campos persistidos por el funnel nuevo: nombre, email,
 *     WhatsApp, landing, trial scheduled, status
 *   - Cada lead linka a /admin/leads/[id] para acción (Stiv sigue
 *     funcionando como antes).
 *
 * Las páginas /admin/ads y /admin/leads siguen intactas para uso
 * histórico — esta es la nueva entrada principal.
 *
 * Acceso: solo superadmin / admin.
 */
import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import {
  getFunnelAdsData,
  getAvailableCountries,
  TELEMETRY_STARTS_AT,
} from "@/lib/funnel-ads";
import { getLeads } from "@/lib/dashboard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ColdCallToggle } from "@/components/admin/ColdCallToggle";
import { RefreshButton } from "../ads/RefreshButton";

// Tamaño de página en el listado de leads.
const PAGE_SIZE = 50;

// Filtros operativos disponibles como chips encima de la lista.
// Cada uno mapea ?status=trial_scheduled,trial_attended,... → query.
const STATUS_QUICKFILTERS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "trial_pending",  label: "📅 Trial pendiente",   statuses: ["trial_scheduled", "trial_reminded", "link_sent"] },
  { key: "trial_attended", label: "✅ Asistieron",        statuses: ["trial_attended"] },
  { key: "trial_absent",   label: "❌ No asistieron",     statuses: ["trial_absent"] },
  { key: "converted",      label: "💸 Pagaron",           statuses: ["converted"] },
  { key: "lost",           label: "🗑️ Perdidos",          statuses: ["lost"] },
];

export const dynamic = "force-dynamic";
export const metadata = { title: "Funnel · Admin" };

// ── Rangos temporales ──────────────────────────────────────────────
const RANGES: Array<{ label: string; days: number }> = [
  { label: "Hoy",     days: 1   },
  { label: "3 días",  days: 3   },
  { label: "7 días",  days: 7   },
  { label: "14 días", days: 14  },
  { label: "30 días", days: 30  },
  { label: "90 días", days: 90  },
];

type PeriodKey = "week" | "month" | "year";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "week",  label: "Esta semana" },
  { key: "month", label: "Este mes"    },
  { key: "year",  label: "Este año"    },
];

function daysFromPeriod(period: PeriodKey): number {
  const berlinNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }),
  );
  let startMs: number;
  if (period === "week") {
    const day = berlinNow.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(berlinNow);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(berlinNow.getDate() - daysSinceMonday);
    startMs = monday.getTime();
  } else if (period === "month") {
    const first = new Date(berlinNow);
    first.setHours(0, 0, 0, 0);
    first.setDate(1);
    startMs = first.getTime();
  } else {
    const jan1 = new Date(berlinNow);
    jan1.setHours(0, 0, 0, 0);
    jan1.setMonth(0, 1);
    startMs = jan1.getTime();
  }
  const diffDays = Math.ceil((berlinNow.getTime() - startMs) / 86_400_000) + 1;
  return Math.max(1, Math.min(365, diffDays));
}

// ── Mapa de atribución landing → label amigable + badge ───────────
type LandingMeta = { label: string; sourceLabel: string; sourceIcon: string; sourceCls: string };
const SRC_ADS    = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
const SRC_SOCIAL = "bg-purple-500/15  text-purple-300  border-purple-500/30";
const SRC_DIRECT = "bg-sky-500/15     text-sky-300     border-sky-500/30";
const SRC_OTHER  = "bg-white/5        text-white/60    border-white/10";
const LANDING_META: Record<string, LandingMeta> = {
  "socialmedia":            { label: "Home (redes sociales)",       sourceLabel: "Social", sourceIcon: "📱", sourceCls: SRC_SOCIAL },
  "home":                   { label: "Home (legacy)",               sourceLabel: "Social", sourceIcon: "📱", sourceCls: SRC_SOCIAL },
  "curso-online":           { label: "Curso de alemán online",      sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "particulares":           { label: "Clases particulares",         sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "intensivo":              { label: "Curso intensivo",             sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "certificado":            { label: "Certificado oficial",         sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "b2-trabajar":            { label: "B2 para trabajar",            sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "clases-aleman-ciudades": { label: "Clases por ciudades",         sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "ciudades":               { label: "Clases por ciudades",         sourceLabel: "Ads",    sourceIcon: "🟢", sourceCls: SRC_ADS    },
  "agendar-directo":        { label: "Atajo CTA verde",             sourceLabel: "Directo",sourceIcon: "⚡", sourceCls: SRC_DIRECT },
  "(sin landing)":          { label: "(sin atribución)",            sourceLabel: "Otro",   sourceIcon: "❓", sourceCls: SRC_OTHER  },
};

const COUNTRY_NAMES: Record<string, string> = {
  ES: "🇪🇸 España", DE: "🇩🇪 Alemania", AT: "🇦🇹 Austria", CH: "🇨🇭 Suiza",
  AR: "🇦🇷 Argentina", MX: "🇲🇽 México", CO: "🇨🇴 Colombia", CL: "🇨🇱 Chile",
  PE: "🇵🇪 Perú", UY: "🇺🇾 Uruguay", PY: "🇵🇾 Paraguay", BO: "🇧🇴 Bolivia",
  EC: "🇪🇨 Ecuador", VE: "🇻🇪 Venezuela", CR: "🇨🇷 Costa Rica", PA: "🇵🇦 Panamá",
  DO: "🇩🇴 Rep. Dom.", GT: "🇬🇹 Guatemala", HN: "🇭🇳 Honduras", NI: "🇳🇮 Nicaragua",
  SV: "🇸🇻 El Salvador", CU: "🇨🇺 Cuba", BR: "🇧🇷 Brasil", US: "🇺🇸 EE.UU.",
};

function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? `🌐 ${code}`;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Construye una URL de /admin/funnel preservando todos los filtros
 *  activos. Para construir chips toggleables, llamar con el filtro a
 *  cambiar (con "" o undefined para desactivarlo). Resetea page=1 porque
 *  cambiar filtros desplaza la paginación. */
function buildFilterUrl(args: {
  period?:    PeriodKey | "";
  days?:      number;
  country?:   string;
  q?:         string;
  status?:    string;
  has_trial?: "yes" | "no";
  cold_call?: "pending" | "done";
}): string {
  return `/admin/funnel${qs({
    ...(args.period ? { period: args.period } : { days: args.days }),
    country:   args.country   || undefined,
    q:         args.q         || undefined,
    status:    args.status    || undefined,
    has_trial: args.has_trial,
    cold_call: args.cold_call,
    // page intencionalmente omitido — cambia de filtro = vuelve a página 1
  })}`;
}

// ── Página ─────────────────────────────────────────────────────────
export default async function FunnelControlPage({
  searchParams,
}: {
  searchParams: Promise<{
    days?: string; country?: string; period?: string; q?: string;
    status?: string; has_trial?: string; cold_call?: string; page?: string;
  }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;
  const searchQuery = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";

  // Filtros operativos de la lista.
  const statusFilterKey = typeof sp.status === "string" ? sp.status.trim() : "";
  const statusFilterCfg = STATUS_QUICKFILTERS.find(f => f.key === statusFilterKey);
  const hasTrialFilter: "yes" | "no" | undefined =
    sp.has_trial === "yes" || sp.has_trial === "no" ? sp.has_trial : undefined;
  const coldCallFilter: "pending" | "done" | undefined =
    sp.cold_call === "pending" || sp.cold_call === "done" ? sp.cold_call : undefined;

  // Página actual (1-based) para paginación. Clamp 1..N.
  const pageNum = Math.max(1, Math.min(999, Number(sp.page ?? 1) || 1));

  const periodRaw = (sp.period ?? "").trim().toLowerCase();
  const activePeriod: PeriodKey | "" =
    periodRaw === "week" || periodRaw === "month" || periodRaw === "year"
      ? periodRaw : "";

  let activeDays: number;
  if (activePeriod) {
    activeDays = daysFromPeriod(activePeriod);
  } else {
    const daysRaw = Number(sp.days ?? 7);
    activeDays = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365
      ? Math.round(daysRaw) : 7;
  }

  const countryRaw = (sp.country ?? "").trim().toUpperCase();
  const activeCountry = countryRaw.length === 2 ? countryRaw : "";

  // Datos en paralelo: KPIs + lista de leads.
  // La lista respeta el MISMO rango temporal que los KPIs y la búsqueda
  // libre (?q=), ordenada por created_at DESC (orden de llegada — los
  // nuevos arriba). País NO se aplica a la lista todavía: el campo
  // existe pero pasos 1-2 no lo tienen; agregarlo introduciría ruido.
  const createdSinceIso = new Date(Date.now() - activeDays * 86_400_000).toISOString();
  const [data, availableCountries, leadsResult] = await Promise.all([
    getFunnelAdsData(activeDays, activeCountry || undefined),
    getAvailableCountries(activeDays),
    getLeads({
      limit:        PAGE_SIZE,
      offset:       (pageNum - 1) * PAGE_SIZE,
      createdSince: createdSinceIso,
      sortBy:       "created",
      q:            searchQuery || undefined,
      status:       statusFilterCfg?.statuses,
      has_trial:    hasTrialFilter,
      cold_call:    coldCallFilter,
    }),
  ]);
  const leads = leadsResult.rows;
  const totalPages = Math.max(1, Math.ceil(leadsResult.total / PAGE_SIZE));

  // KPIs derivados (mismos cálculos que /admin/ads — fuente única).
  const entry          = data.steps[0]?.reached ?? 0;
  const formCompleted  = data.steps[2]?.reached ?? 0;
  const trialBooked    = data.steps[3]?.reached ?? 0;
  const ta             = data.trialAttendance;
  const trialAttended  = ta.attended;
  const formVsEntry    = entry         > 0 ? (100 * formCompleted / entry)        : 0;
  const trialVsForm    = formCompleted > 0 ? (100 * trialBooked   / formCompleted): 0;
  const attendanceRatePct = ta.attendance_rate !== null ? 100 * ta.attendance_rate : null;
  const convertedVsAttended = trialAttended > 0 ? (100 * data.totalConverted / trialAttended) : 0;

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-6xl mx-auto">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-white">🎯 Funnel</h1>
          <p className="mt-1 text-xs md:text-sm text-white/60">
            Centro de control. Métricas + leads recién agendados.{" "}
            <Link href="/admin/ads" className="text-warm/80 hover:text-warm underline">Ver dashboard completo</Link>
            {" · "}
            <Link href="/admin/leads" className="text-warm/80 hover:text-warm underline">Ver todos los leads</Link>
          </p>
        </div>
        <RefreshButton at={new Date().toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} />
      </div>

      {/* ── Filtros (rango + país) ───────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1.5">Rango</div>
          <div className="flex gap-1 flex-wrap">
            {RANGES.map(r => (
              <Link
                key={r.days}
                href={`/admin/funnel${qs({ days: r.days, country: activeCountry || undefined, q: searchQuery || undefined })}`}
                className={`px-2.5 py-1.5 rounded-md text-[12.5px] md:text-sm transition ${
                  !activePeriod && r.days === activeDays
                    ? "bg-warm text-warm-foreground font-semibold"
                    : "border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {r.label}
              </Link>
            ))}
            <span className="self-center text-white/20 px-0.5 select-none">·</span>
            {PERIODS.map(p => (
              <Link
                key={p.key}
                href={`/admin/funnel${qs({ period: p.key, country: activeCountry || undefined, q: searchQuery || undefined })}`}
                className={`px-2.5 py-1.5 rounded-md text-[12.5px] md:text-sm transition ${
                  activePeriod === p.key
                    ? "bg-warm text-warm-foreground font-semibold"
                    : "border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="md:w-64">
          <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1.5">País</div>
          <form action="/admin/funnel" method="get" className="flex gap-1.5">
            {activePeriod
              ? <input type="hidden" name="period" value={activePeriod} />
              : <input type="hidden" name="days"   value={activeDays} />
            }
            {searchQuery && <input type="hidden" name="q" value={searchQuery} />}
            <select
              name="country"
              defaultValue={activeCountry}
              className="flex-1 h-9 px-2 rounded-md border border-white/10 bg-white/5 text-sm text-white"
            >
              <option value="">Todos ({availableCountries.reduce((a, c) => a + c.count, 0)} leads)</option>
              {availableCountries.map(c => (
                <option key={c.code} value={c.code}>{countryName(c.code)} · {c.count}</option>
              ))}
            </select>
            <button
              type="submit"
              className="px-3 py-1.5 rounded-md text-sm bg-warm text-warm-foreground font-semibold hover:opacity-90"
            >
              Aplicar
            </button>
          </form>
        </div>
      </section>

      {activeCountry && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-100 flex items-center justify-between gap-3">
          <span>
            Filtrando: <strong>{countryName(activeCountry)}</strong>. Pasos 1-2 no se filtran por país.
          </span>
          <Link
            href={`/admin/funnel${qs({
              ...(activePeriod ? { period: activePeriod } : { days: activeDays }),
              q: searchQuery || undefined,
            })}`}
            className="text-amber-200 hover:text-white underline text-xs whitespace-nowrap"
          >
            Limpiar
          </Link>
        </div>
      )}

      {/* ── SECCIÓN 1: KPIs ──────────────────────────────────── */}
      <section className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-2.5 md:gap-3">
        <KpiCard
          label="Entradas (motivo)"
          value={entry.toLocaleString()}
          subtitle="paso 1 del funnel"
          accent="text-white"
        />
        <KpiCard
          label="Form completado"
          value={formCompleted.toLocaleString()}
          subtitle={entry > 0 ? `${formVsEntry.toFixed(1)}% de Entradas` : "—"}
          accent={formVsEntry < 10 ? "text-red-300" : formVsEntry < 15 ? "text-amber-300" : "text-emerald-300"}
        />
        <KpiCard
          label="Trial agendada"
          value={trialBooked.toLocaleString()}
          subtitle={formCompleted > 0 ? `${trialVsForm.toFixed(1)}% de Form completado` : "—"}
          accent={trialBooked === 0 && formCompleted >= 5 ? "text-red-300" : trialVsForm < 30 ? "text-amber-300" : "text-emerald-300"}
        />
        <KpiCard
          label="Tasa asistencia"
          value={attendanceRatePct !== null ? `${attendanceRatePct.toFixed(1)}%` : "—"}
          subtitle={attendanceRatePct !== null
            ? `${ta.attended}/${ta.attended + ta.absent} resueltos${ta.pending > 0 ? ` · ${ta.pending} pend.` : ""}`
            : ta.pending > 0 ? `${ta.pending} pend.` : "—"}
          accent={attendanceRatePct === null
            ? "text-white"
            : attendanceRatePct >= 70 ? "text-emerald-300"
              : attendanceRatePct >= 50 ? "text-amber-300" : "text-red-300"}
        />
        <KpiCard
          label="Convirtieron"
          value={data.totalConverted.toLocaleString()}
          subtitle={trialAttended > 0 ? `${convertedVsAttended.toFixed(1)}% de Trial asistido` : "—"}
          accent={data.totalConverted === 0 ? "text-white"
            : convertedVsAttended >= 30 ? "text-emerald-300"
              : convertedVsAttended >= 15 ? "text-amber-300" : "text-red-300"}
        />
      </section>

      {/* ── Alertas automáticas ────────────────────────────────── */}
      {data.alerts.length > 0 && (
        <section className="mt-5 space-y-2">
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
                {a.severity === "high" ? "🔴" : a.severity === "medium" ? "🟡" : "🔵"} {a.title}
              </div>
              <div className="mt-1 opacity-90 text-[13px]">{a.detail}</div>
            </div>
          ))}
        </section>
      )}

      {/* ── Desglose "Por landing / fuente" ────────────────────── */}
      <section className="mt-6">
        <details className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-white/85 hover:bg-white/[0.05] select-none">
            📊 Por landing / fuente <span className="ml-2 text-[11px] font-normal text-white/45">{data.landingBreakdown.length} buckets · click para abrir</span>
          </summary>
          <div className="overflow-x-auto border-t border-white/10">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-white/50 bg-white/5">
                <tr>
                  <th className="text-left py-2 pl-4 pr-3">Landing</th>
                  <th className="text-left py-2 px-3">Fuente</th>
                  <th className="text-right py-2 px-3">Sesiones</th>
                  <th className="text-right py-2 px-3">Form</th>
                  <th className="text-right py-2 px-3">Trial</th>
                  <th className="text-right py-2 px-3">Asistencia</th>
                  <th className="text-right py-2 pr-4 pl-3">Pagaron</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.landingBreakdown.map(l => {
                  const meta = LANDING_META[l.landing] ?? LANDING_META["(sin landing)"];
                  const attRate = l.attendance_rate;
                  return (
                    <tr key={l.landing} className="hover:bg-white/[0.03]">
                      <td className="py-2 pl-4 pr-3">
                        <div className="text-white font-semibold text-[13px]">{meta.label}</div>
                        <div className="text-[10px] text-white/40 font-mono">{l.landing}</div>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border ${meta.sourceCls}`}>
                          {meta.sourceIcon} {meta.sourceLabel}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-white/80 tabular-nums">{l.sessions}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        <span className={l.pct_form < 5 ? "text-red-300" : l.pct_form < 10 ? "text-amber-300" : "text-emerald-300"}>
                          {l.form_completed}<span className="ml-1 text-[10px] text-white/40">({l.pct_form.toFixed(1)}%)</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        <span className={l.pct_trial < 2 ? "text-red-300" : l.pct_trial < 5 ? "text-amber-300" : "text-emerald-300"}>
                          {l.trial_booked}<span className="ml-1 text-[10px] text-white/40">({l.pct_trial.toFixed(1)}%)</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {attRate === null
                          ? <span className="text-white/30">—</span>
                          : <span className={attRate >= 0.7 ? "text-emerald-300" : attRate >= 0.5 ? "text-amber-300" : "text-red-300"}>
                              {(100 * attRate).toFixed(0)}%
                              <span className="ml-1 text-[10px] text-white/40">({l.trial_attended}/{l.trial_attended + l.trial_absent})</span>
                            </span>}
                      </td>
                      <td className="py-2 pr-4 pl-3 text-right text-white/80 tabular-nums">{l.converted}</td>
                    </tr>
                  );
                })}
                {data.landingBreakdown.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-white/40 italic">Sin datos por landing en este rango.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ── SECCIÓN 2: Leads recientes ────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Leads recientes
            <span className="ml-2 text-xs text-white/40 font-normal">
              {searchQuery
                ? `${leadsResult.total} con "${searchQuery}"`
                : `${leadsResult.total} en este rango · orden de llegada`}
            </span>
          </h2>
          <Link
            href="/admin/leads"
            className="text-[12px] text-warm/80 hover:text-warm underline whitespace-nowrap"
          >
            Ver todos →
          </Link>
        </div>

        {/* Buscador — nombre, email o WhatsApp. Preserva los demás
            filtros (rango, periodo, país) vía inputs ocultos. */}
        <form action="/admin/funnel" method="get" className="mb-3 flex gap-2">
          {activePeriod
            ? <input type="hidden" name="period" value={activePeriod} />
            : <input type="hidden" name="days"   value={activeDays} />}
          {activeCountry && <input type="hidden" name="country" value={activeCountry} />}
          <input
            type="text"
            name="q"
            defaultValue={searchQuery}
            placeholder="Buscar por nombre, email o WhatsApp…"
            className="flex-1 h-9 px-3 rounded-md border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/35
                       focus:outline-none focus:border-warm/60"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md text-sm bg-warm text-warm-foreground font-semibold hover:opacity-90"
          >
            Buscar
          </button>
          {searchQuery && (
            <Link
              href={`/admin/funnel${qs({
                ...(activePeriod ? { period: activePeriod } : { days: activeDays }),
                country: activeCountry || undefined,
                status: statusFilterKey || undefined,
                has_trial: hasTrialFilter,
                cold_call: coldCallFilter,
              })}`}
              className="px-3 py-1.5 rounded-md text-sm border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
            >
              Limpiar
            </Link>
          )}
        </form>

        {/* Filtros operativos rápidos — chips de status + has_trial +
            cold_call. Cada chip preserva los demás filtros activos
            (rango, país, búsqueda) vía helper buildFilterUrl. */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {/* Status quick filters */}
          {STATUS_QUICKFILTERS.map(f => {
            const active = statusFilterKey === f.key;
            return (
              <Link
                key={f.key}
                href={buildFilterUrl({
                  period: activePeriod, days: activeDays, country: activeCountry,
                  q: searchQuery, status: active ? "" : f.key,
                  has_trial: hasTrialFilter, cold_call: coldCallFilter,
                })}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${
                  active
                    ? "bg-warm text-warm-foreground border-warm"
                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
          {/* Has trial yes/no */}
          <span className="w-px bg-white/10 mx-1" aria-hidden />
          {([
            { v: "yes" as const, label: "🗓 con trial" },
            { v: "no"  as const, label: "∅ sin trial"  },
          ]).map(o => {
            const active = hasTrialFilter === o.v;
            return (
              <Link
                key={o.v}
                href={buildFilterUrl({
                  period: activePeriod, days: activeDays, country: activeCountry,
                  q: searchQuery, status: statusFilterKey,
                  has_trial: active ? undefined : o.v,
                  cold_call: coldCallFilter,
                })}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${
                  active
                    ? "bg-sky-500/30 text-sky-100 border-sky-500/40"
                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              >
                {o.label}
              </Link>
            );
          })}
          {/* Cold call */}
          <span className="w-px bg-white/10 mx-1" aria-hidden />
          {([
            { v: "pending" as const, label: "📞 cold-call pendiente" },
            { v: "done"    as const, label: "✓ cold-call hecha" },
          ]).map(o => {
            const active = coldCallFilter === o.v;
            return (
              <Link
                key={o.v}
                href={buildFilterUrl({
                  period: activePeriod, days: activeDays, country: activeCountry,
                  q: searchQuery, status: statusFilterKey,
                  has_trial: hasTrialFilter,
                  cold_call: active ? undefined : o.v,
                })}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${
                  active
                    ? "bg-purple-500/30 text-purple-100 border-purple-500/40"
                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              >
                {o.label}
              </Link>
            );
          })}
        </div>

        {/* Desktop: tabla con columnas operativas (nivel, próximo
            contacto, # seguimientos, cold-call toggle inline). */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-white/50 bg-white/5">
              <tr>
                <th className="text-left py-2 px-3">Lead</th>
                <th className="text-left py-2 px-3">Contacto</th>
                <th className="text-left py-2 px-3">Origen</th>
                <th className="text-left py-2 px-3">Nivel</th>
                <th className="text-left py-2 px-3">Trial</th>
                <th className="text-left py-2 px-3">Próximo</th>
                <th className="text-left py-2 px-3">Estado</th>
                <th className="text-left py-2 px-3">📞</th>
                <th className="text-right py-2 pr-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {leads.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-white/40 italic">
                  Sin leads que coincidan con los filtros activos
                </td></tr>
              )}
              {leads.map(l => {
                const meta = LANDING_META[l.landing_intent ?? "(sin landing)"] ?? LANDING_META["(sin landing)"];
                const attState = l.trial_attended_at ? "attended"
                  : l.trial_absent_at ? "absent"
                  : l.trial_scheduled_at ? "scheduled" : null;
                return (
                  <tr key={l.id} className="hover:bg-white/[0.03]">
                    <td className="py-2 px-3">
                      <div className="text-white font-semibold">{l.name ?? "(sin nombre)"}</div>
                      <div className="text-[10.5px] text-white/40">
                        {fmtRelative(l.created_at)}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="text-[12px] text-white/70 truncate max-w-[180px]">{l.email ?? "—"}</div>
                      <div className="text-[11px] text-white/50 font-mono">{l.whatsapp_normalized ?? "—"}</div>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border ${meta.sourceCls}`}>
                        {meta.sourceIcon} {meta.sourceLabel}
                      </span>
                      <div className="text-[10.5px] text-white/45 mt-0.5 truncate max-w-[160px]" title={meta.label}>{meta.label}</div>
                    </td>
                    <td className="py-2 px-3 text-[12px] text-white/70 font-mono">{l.german_level ?? "—"}</td>
                    <td className="py-2 px-3 text-[12px]">
                      {l.trial_scheduled_at ? (
                        <>
                          <div className="text-white/80 tabular-nums whitespace-nowrap">{fmtTrialDate(l.trial_scheduled_at)}</div>
                          {attState === "attended" && <span className="text-[10px] text-emerald-300">✓ asistió</span>}
                          {attState === "absent" && <span className="text-[10px] text-red-300">✗ no asistió</span>}
                          {attState === "scheduled" && <span className="text-[10px] text-white/40">pendiente</span>}
                        </>
                      ) : <span className="text-white/30">—</span>}
                    </td>
                    <td className="py-2 px-3 text-[12px]">
                      {l.next_contact_date ? (
                        <div className={`tabular-nums whitespace-nowrap ${
                          new Date(l.next_contact_date).getTime() < Date.now() ? "text-amber-300" : "text-white/65"
                        }`}>
                          {fmtNextContact(l.next_contact_date)}
                        </div>
                      ) : <span className="text-white/30">—</span>}
                      {l.current_followup_number > 0 && (
                        <div className="text-[10px] text-white/40">{l.current_followup_number} seg.</div>
                      )}
                    </td>
                    <td className="py-2 px-3"><StatusBadge status={l.status} /></td>
                    <td className="py-2 px-3">
                      <ColdCallToggle leadId={l.id} coldCallDoneAt={l.cold_call_done_at} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Link
                        href={`/admin/leads/${l.id}`}
                        className="text-warm/80 hover:text-warm text-[12px] font-semibold whitespace-nowrap"
                      >
                        Abrir →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards apilados */}
        <div className="md:hidden space-y-2">
          {leads.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center text-white/40 italic text-sm">
              Sin leads en el sistema
            </div>
          )}
          {leads.map(l => {
            const meta = LANDING_META[l.landing_intent ?? "(sin landing)"] ?? LANDING_META["(sin landing)"];
            const attState = l.trial_attended_at ? "attended"
              : l.trial_absent_at ? "absent"
              : l.trial_scheduled_at ? "scheduled" : null;
            return (
              <Link
                key={l.id}
                href={`/admin/leads/${l.id}`}
                className="block rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-3 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-semibold text-[14px]">{l.name ?? "(sin nombre)"}</div>
                    <div className="text-[11px] text-white/40">{fmtRelative(l.updated_at ?? l.created_at)}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${meta.sourceCls} shrink-0`}>
                    {meta.sourceIcon} {meta.sourceLabel}
                  </span>
                </div>
                <div className="mt-1.5 text-[11.5px] text-white/55 truncate">{l.email ?? "—"}</div>
                <div className="text-[11px] text-white/45 font-mono">{l.whatsapp_normalized ?? "—"}</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[11px]">
                    {l.trial_scheduled_at ? (
                      <span className="text-white/70">
                        🗓 {fmtTrialDate(l.trial_scheduled_at)}
                        {attState === "attended" && <span className="ml-1.5 text-emerald-300">✓</span>}
                        {attState === "absent"   && <span className="ml-1.5 text-red-300">✗</span>}
                        {attState === "scheduled"&& <span className="ml-1.5 text-white/40">…</span>}
                      </span>
                    ) : <span className="text-white/30">sin trial</span>}
                  </div>
                  <StatusBadge status={l.status} />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Paginación — solo aparece si hay más de 1 página de resultados. */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <div className="text-white/45 text-[11.5px]">
              Página {pageNum} de {totalPages} · {leadsResult.total} leads totales
            </div>
            <div className="flex gap-2">
              {pageNum > 1 && (
                <Link
                  href={`/admin/funnel${qs({
                    ...(activePeriod ? { period: activePeriod } : { days: activeDays }),
                    country: activeCountry || undefined,
                    q: searchQuery || undefined,
                    status: statusFilterKey || undefined,
                    has_trial: hasTrialFilter,
                    cold_call: coldCallFilter,
                    page: pageNum - 1,
                  })}`}
                  className="px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[12px]"
                >
                  ← Anterior
                </Link>
              )}
              {pageNum < totalPages && (
                <Link
                  href={`/admin/funnel${qs({
                    ...(activePeriod ? { period: activePeriod } : { days: activeDays }),
                    country: activeCountry || undefined,
                    q: searchQuery || undefined,
                    status: statusFilterKey || undefined,
                    has_trial: hasTrialFilter,
                    cold_call: coldCallFilter,
                    page: pageNum + 1,
                  })}`}
                  className="px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[12px]"
                >
                  Siguiente →
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="mt-8 text-center text-[10.5px] text-white/30">
        Datos en vivo · funnel simplificado activado {TELEMETRY_STARTS_AT}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function KpiCard({
  label, value, subtitle, accent,
}: {
  label:    string;
  value:    string;
  subtitle?:string;
  accent:   string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 md:p-4">
      <div className="text-[10.5px] uppercase tracking-wider text-white/45">{label}</div>
      <div className={`mt-1 text-2xl md:text-3xl font-extrabold tabular-nums ${accent}`}>{value}</div>
      {subtitle && <div className="mt-1 text-[10.5px] md:text-[11px] text-white/50">{subtitle}</div>}
    </div>
  );
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1)    return "ahora mismo";
  if (min < 60)   return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24)    return `hace ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30)     return `hace ${d}d`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function fmtTrialDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

/** "hoy 14:30", "mañana 09:00", "vie 21 12:00" o "vencido hace 2h". */
function fmtNextContact(iso: string): string {
  const dt = new Date(iso);
  const now = Date.now();
  const diffMs = dt.getTime() - now;
  if (diffMs < 0) {
    const h = Math.round(-diffMs / 3_600_000);
    return h < 1 ? "vencido" : h < 48 ? `vencido ${h}h` : "vencido";
  }
  const hours = dt.toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const targetKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
  if (targetKey === todayKey) return `hoy ${hours}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
  if (targetKey === tomKey) return `mañana ${hours}`;
  return dt.toLocaleDateString("es-ES", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric" }) + ` ${hours}`;
}
