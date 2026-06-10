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
import { getFunnelAdsData, getAvailableCountries, TELEMETRY_STARTS_AT } from "@/lib/funnel-ads";
import { RefreshButton } from "./RefreshButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funnel Ads · Admin" };

// Filtros de rango de días — granularidad amplia desde "hoy" hasta
// 90 días. El usuario también puede pasar ?days=N arbitrario en URL.
const RANGES: Array<{ label: string; days: number }> = [
  { label: "Hoy",      days: 1   },
  { label: "3 días",   days: 3   },
  { label: "7 días",   days: 7   },
  { label: "14 días",  days: 14  },
  { label: "30 días",  days: 30  },
  { label: "90 días",  days: 90  },
];

// Nombre legible por código ISO-2 para el dropdown de país.
const COUNTRY_NAMES: Record<string, string> = {
  ES: "🇪🇸 España",     DE: "🇩🇪 Alemania",   AT: "🇦🇹 Austria",
  CH: "🇨🇭 Suiza",      AR: "🇦🇷 Argentina",  MX: "🇲🇽 México",
  CO: "🇨🇴 Colombia",   CL: "🇨🇱 Chile",       PE: "🇵🇪 Perú",
  UY: "🇺🇾 Uruguay",    PY: "🇵🇾 Paraguay",    BO: "🇧🇴 Bolivia",
  EC: "🇪🇨 Ecuador",    VE: "🇻🇪 Venezuela",   CR: "🇨🇷 Costa Rica",
  PA: "🇵🇦 Panamá",     DO: "🇩🇴 Rep. Dom.",   GT: "🇬🇹 Guatemala",
  HN: "🇭🇳 Honduras",   NI: "🇳🇮 Nicaragua",   SV: "🇸🇻 El Salvador",
  CU: "🇨🇺 Cuba",       BR: "🇧🇷 Brasil",      US: "🇺🇸 EE.UU.",
  FR: "🇫🇷 Francia",    IT: "🇮🇹 Italia",      PT: "🇵🇹 Portugal",
  GB: "🇬🇧 Reino Unido", NL: "🇳🇱 P. Bajos",   BE: "🇧🇪 Bélgica",
  XX: "🌐 Otro / sin país",
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

export default async function FunnelAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; country?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;

  // Días: aceptamos cualquier número 1-365 desde URL; si no, default 30.
  const daysRaw = Number(sp.days ?? 30);
  const activeDays = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365
    ? Math.round(daysRaw) : 30;

  // País: ISO-2 mayúsculas; vacío = todos.
  const countryRaw = (sp.country ?? "").trim().toUpperCase();
  const activeCountry = countryRaw.length === 2 ? countryRaw : "";

  const [data, availableCountries] = await Promise.all([
    getFunnelAdsData(activeDays, activeCountry || undefined),
    getAvailableCountries(activeDays),
  ]);

  // ¿La ventana incluye días previos al lanzamiento de telemetría
  // granular? Si sí, advertir que paso 2 (nivel) puede tener datos
  // incompletos (en aquellos días no se persistía a funnel_progress).
  const telemetryDate = new Date(TELEMETRY_STARTS_AT);
  const cutoffDate = new Date(Date.now() - activeDays * 86_400_000);
  const partialTelemetry = cutoffDate < telemetryDate;

  // Cadena del embudo: cada KPI muestra % del paso INMEDIATAMENTE
  // anterior, no del paso 1. Da una lectura más útil ("¿cuántos de
  // los que llegaron al paso anterior pasaron al siguiente?").
  const entry = data.steps[0]?.reached ?? 0;
  const formCompleted = data.steps[2]?.reached ?? 0;
  const trialBooked = data.steps[3]?.reached ?? 0;
  const ta = data.trialAttendance;
  const trialAttended = ta.attended;

  const formVsEntry        = entry         > 0 ? (100 * formCompleted  / entry)         : 0;
  const trialVsForm        = formCompleted > 0 ? (100 * trialBooked    / formCompleted) : 0;
  const attendedVsTrial    = trialBooked   > 0 ? (100 * trialAttended  / trialBooked)   : 0;
  const convertedVsAttended = trialAttended > 0 ? (100 * data.totalConverted / trialAttended) : 0;

  // % de no-show solo para la alerta opcional bajo la fila (no se
  // pinta como card propio — los KPIs principales son la cadena
  // de conversión).
  const taResolved  = ta.attended + ta.absent;
  const noShowRate  = taResolved > 0 ? (100 * ta.absent / taResolved) : 0;

  return (
    <div className="px-5 md:px-8 py-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">📊 Funnel Ads</h1>
          <p className="mt-1 text-sm text-white/60">
            Quiz de <strong>2 preguntas</strong> (motivo + nivel) → datos → trial. Goal/urgencia/budget
            los recoge Stiv por WhatsApp (eliminados del funnel el {TELEMETRY_STARTS_AT}).
          </p>
        </div>
        <RefreshButton at={new Date().toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" })} />
      </div>

      {/* ── Filtros ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col md:flex-row gap-3 md:items-center">
        {/* Días */}
        <div className="flex-1">
          <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Rango</div>
          <div className="flex gap-1 flex-wrap">
            {RANGES.map(r => (
              <Link
                key={r.days}
                href={`/admin/ads${qs({ days: r.days, country: activeCountry || undefined })}`}
                className={`px-3 py-1.5 rounded-md text-sm transition ${
                  r.days === activeDays
                    ? "bg-warm text-warm-foreground font-semibold"
                    : "border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>

        {/* País */}
        <div className="md:w-72">
          <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1.5">País</div>
          <form action="/admin/ads" method="get" className="flex gap-1.5">
            <input type="hidden" name="days" value={activeDays} />
            <select
              name="country"
              defaultValue={activeCountry}
              className="flex-1 h-9 px-2 rounded-md border border-white/10 bg-white/5 text-sm text-white"
            >
              <option value="">Todos ({availableCountries.reduce((a, c) => a + c.count, 0)} leads)</option>
              {availableCountries.map(c => (
                <option key={c.code} value={c.code}>
                  {countryName(c.code)} · {c.count}
                </option>
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
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 flex items-center justify-between gap-3">
          <span>
            Filtrando por país: <strong>{countryName(activeCountry)}</strong>. Los pasos 1 y 2 (sesiones)
            no se filtran por país — sólo conocemos el país tras el paso 3 (form completado).
          </span>
          <Link
            href={`/admin/ads${qs({ days: activeDays })}`}
            className="text-amber-200 hover:text-white underline text-xs whitespace-nowrap"
          >
            Limpiar filtro
          </Link>
        </div>
      )}

      {/* KPIs grandes — cadena del funnel.
          Cada card muestra el % del paso INMEDIATAMENTE anterior. */}
      <section className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="Entradas (motivo)"
          value={entry.toLocaleString()}
          accent="text-white"
        />
        <KpiCard
          label="Form completado"
          value={`${formCompleted.toLocaleString()}`}
          subtitle={entry > 0 ? `${formVsEntry.toFixed(1)}% de Entradas` : "—"}
          accent={formVsEntry < 10 ? "text-red-300" : formVsEntry < 15 ? "text-amber-300" : "text-emerald-300"}
        />
        <KpiCard
          label="Trial agendada"
          value={`${trialBooked.toLocaleString()}`}
          subtitle={formCompleted > 0 ? `${trialVsForm.toFixed(1)}% de Form completado` : "—"}
          accent={trialBooked === 0 && formCompleted >= 5 ? "text-red-300" : trialVsForm < 30 ? "text-amber-300" : "text-emerald-300"}
        />
        <KpiCard
          label="Trial asistido"
          value={`${trialAttended.toLocaleString()}`}
          subtitle={trialBooked > 0
            ? `${attendedVsTrial.toFixed(1)}% de Trial agendada${ta.pending > 0 ? ` · ${ta.pending} pend.` : ""}`
            : "Sin trials en el rango"}
          accent={
            trialBooked === 0
              ? "text-white"
              : attendedVsTrial >= 70
                ? "text-emerald-300"
                : attendedVsTrial >= 50
                  ? "text-amber-300"
                  : "text-red-300"
          }
        />
        <KpiCard
          label="Convirtieron (pago)"
          value={`${data.totalConverted}`}
          subtitle={trialAttended > 0
            ? `${convertedVsAttended.toFixed(1)}% de Trial asistido`
            : trialBooked > 0
              ? "Sin asistidos marcados"
              : "Sin trials en el rango"}
          accent={
            trialAttended === 0
              ? "text-white"
              : convertedVsAttended >= 30
                ? "text-emerald-300"
                : convertedVsAttended >= 15
                  ? "text-amber-300"
                  : "text-red-300"
          }
        />
      </section>

      {/* Alerta de no-show alto debajo de la fila de KPIs si aplica. */}
      {ta.absent > 0 && noShowRate >= 30 && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          ⚠️ Tasa de no-show alta ({noShowRate.toFixed(0)}% — {ta.absent} de {taResolved} marcados).
          Revisar recordatorios pre-trial, calidad del lead por motivo y país.
        </div>
      )}

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
        <h2 className="text-lg font-semibold text-white">Embudo {activeCountry ? `· ${countryName(activeCountry)}` : ""}</h2>
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

      {/* ── Micro-embudo del paso 3 (form) ───────────────────── */}
      <MicroFunnelSection data={data.microFunnel} />

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

// ── Micro-embudo del paso 3 (form) ────────────────────────────────
// Desglosa qué pasa entre "lead eligió nivel" y "lead creado": ¿llegó
// al form? ¿escribió algo? ¿intentó enviar? ¿qué validación falló?
function MicroFunnelSection({ data }: { data: import("@/lib/funnel-ads").MicroFunnelData }) {
  // Cada sub-paso muestra el % vs el anterior. El "drop" entre dos
  // sub-pasos es donde se va el lead.
  const subSteps = [
    { label: "Eligen nivel (paso 2)",        n: data.reached_step2,          colorBase: "from-warm to-amber-300" },
    { label: "Abre el form",                  n: data.reached_form_opened,    colorBase: "from-warm to-amber-300" },
    { label: "Escribe al menos 1 carácter",   n: data.reached_field_typed,    colorBase: "from-warm to-amber-300" },
    { label: "Pulsa Crear mi plan",           n: data.reached_submit_attempt, colorBase: "from-warm to-amber-300" },
    { label: "Lead creado OK (paso 6)",       n: data.reached_submit_ok,      colorBase: "from-emerald-500 to-emerald-300" },
  ];
  const entry = subSteps[0].n || 1;

  const hasMicroData = subSteps.slice(1).some(s => s.n > 0);

  // Mapeo de outcome → etiqueta humana + color (semáforo).
  const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
    submit_attempt:                { label: "🟢 OK (pasó a paso 6)",           color: "text-emerald-300" },
    client_invalid_name:           { label: "🔴 Validación cliente: nombre",   color: "text-red-300" },
    client_invalid_email:          { label: "🔴 Validación cliente: email",    color: "text-red-300" },
    client_invalid_phone:          { label: "🔴 Validación cliente: WhatsApp", color: "text-red-300" },
    network_error:                 { label: "🟡 Error de red (lead sin internet)", color: "text-amber-300" },
    server_bad_response:           { label: "🔴 Respuesta servidor inesperada", color: "text-red-300" },
    rate_limited:                  { label: "🟡 Rate limit (10/IP/10min)",     color: "text-amber-300" },
    already_registered:            { label: "🔵 Email ya registrado",          color: "text-blue-300" },
    server_validation_email:       { label: "🔴 Server: email inválido",       color: "text-red-300" },
    server_validation_whatsapp_e164: { label: "🔴 Server: WhatsApp inválido",  color: "text-red-300" },
    server_validation_name:        { label: "🔴 Server: nombre inválido",      color: "text-red-300" },
  };

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-white">Micro-embudo del paso 3 (form)</h2>
      <p className="mt-1 text-xs text-white/55">
        Dentro del paso 3 (formulario de datos): ¿dónde se pierden los leads exactamente?
        Telemetría activa desde {data.microStartsAt}.
      </p>

      {!hasMicroData && (
        <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
          ℹ️ Sin datos en este rango. La telemetría granular empezó el {data.microStartsAt} —
          los nuevos leads desde esa fecha generan estos micro-eventos. Refresca esta
          página dentro de unas horas para ver los primeros datos.
        </div>
      )}

      {hasMicroData && (
        <>
          <div className="mt-3 space-y-2">
            {subSteps.map((s, i) => {
              const widthPct = entry > 0 ? 100 * s.n / entry : 0;
              const prev = i > 0 ? subSteps[i - 1].n : null;
              const drop = prev !== null && prev > 0 ? 100 * (prev - s.n) / prev : null;
              const dropColor = drop === null ? "text-white/40"
                : drop >= 50 ? "text-red-300"
                : drop >= 25 ? "text-amber-300"
                : "text-emerald-300";
              return (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                    <span className="font-medium text-white">{s.label}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-white/60">{s.n.toLocaleString()} sesiones</span>
                      {drop !== null && (
                        <span className={dropColor}>−{drop.toFixed(1)}% vs. anterior</span>
                      )}
                      <span className="text-white/40 tabular-nums w-14 text-right">
                        {widthPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-white/5 overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${s.colorBase} rounded-full transition-all`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Outcomes del submit (por qué se rechazó / aprobó) */}
          {data.outcomes.length > 0 && (
            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-wider text-white/50">
                Resultados del envío
              </div>
              <div className="text-sm font-semibold text-white mt-0.5">
                ¿Por qué se rechaza o aprueba "Crear mi plan"?
              </div>
              <p className="text-xs text-white/45 mt-1">
                Último outcome por sesión que intentó enviar. Si vieras
                muchos <strong>client_invalid_phone</strong>, la validación de WhatsApp es
                el culpable.
              </p>
              <div className="mt-3 space-y-1.5">
                {data.outcomes.map(o => {
                  const info = OUTCOME_LABELS[o.outcome] ?? {
                    label: o.outcome,
                    color: "text-white/70",
                  };
                  return (
                    <div key={o.outcome} className="text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`${info.color} truncate flex-1`} title={o.outcome}>
                          {info.label}
                        </span>
                        <span className="text-white/55 tabular-nums shrink-0">
                          {o.count} ({o.pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full bg-warm/70"
                          style={{ width: `${o.pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
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

