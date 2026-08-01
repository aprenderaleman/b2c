import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { formatMonthEs, getTeacherEarningsSummary, moneyFromCents } from "@/lib/finance";
import { supabaseAdmin } from "@/lib/supabase";
import { RefreshEarningsButton } from "./refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis ganancias · Profesor" };

export default async function TeacherEarningsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis ganancias</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor asociado.
        </p>
      </main>
    );
  }

  const months = await getTeacherEarningsSummary(teacher.id, 12);
  const currentMonthStr = new Date().toISOString().slice(0, 7) + "-01";
  const current = months.find(m => m.month.startsWith(currentMonthStr.slice(0, 7))) ?? {
    amount_cents: 0, total_minutes: 0, classes_count: 0,
    currency: teacher.currency, paid: false, paid_at: null,
    payment_reference: null, locked: false,
    id: null, teacher_id: teacher.id, month: currentMonthStr,
  };

  const previous = months.filter(m => !m.month.startsWith(currentMonthStr.slice(0, 7)));

  // Stats acumulados
  const totalEarned = months.reduce((s, m) => s + m.amount_cents, 0);
  const totalHours = months.reduce((s, m) => s + m.total_minutes, 0) / 60;
  const totalClasses = months.reduce((s, m) => s + m.classes_count, 0);
  const monthsWithData = months.filter(m => m.classes_count > 0).length;
  const avgMonthly = monthsWithData > 0 ? Math.round(totalEarned / monthsWithData) : 0;

  // Datos para gráficos (últimos 6 meses, orden cronológico)
  const chartMonths = [...months].reverse().slice(-6);
  const maxEarnings = Math.max(...chartMonths.map(m => m.amount_cents), 100);
  const maxHours = Math.max(...chartMonths.map(m => m.total_minutes / 60), 1);

  return (
    <main className="space-y-6">
      <header>
        <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Mis ganancias
          </h1>
          <RefreshEarningsButton />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tu progreso mes a mes en Aprender-Aleman.de
        </p>
      </header>

      {/* ── Stats principales ── */}
      <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Este mes"
          value={moneyFromCents(current.amount_cents, current.currency)}
          sub={`${current.classes_count} clase${current.classes_count === 1 ? "" : "s"}`}
          accent
        />
        <StatCard
          label="Total acumulado"
          value={moneyFromCents(totalEarned, current.currency)}
          sub={`${totalClasses} clases en total`}
        />
        <StatCard
          label="Promedio mensual"
          value={moneyFromCents(avgMonthly, current.currency)}
          sub={`Últimos ${monthsWithData} mes${monthsWithData === 1 ? "" : "es"} activo${monthsWithData === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Horas totales"
          value={`${totalHours.toFixed(1)} h`}
          sub={current.paid ? "Este mes: Pagado ✓" : "Este mes: Pendiente"}
        />
      </section>

      {/* ── Gráfico de ganancias ── */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Ganancias mensuales
        </h2>
        <div className="mt-4">
          <EarningsChart months={chartMonths} maxCents={maxEarnings} currency={current.currency} />
        </div>
      </section>

      {/* ── Gráfico de horas ── */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Horas trabajadas
        </h2>
        <div className="mt-4">
          <HoursChart months={chartMonths} maxHours={maxHours} />
        </div>
      </section>

      {/* ── Tabla histórica ── */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Detalle por mes
        </h2>
        {months.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Aún no hay datos. Este es tu primer mes.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <Th>Mes</Th>
                  <Th>Clases</Th>
                  <Th>Horas</Th>
                  <Th>Ganancia</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {months.map(m => (
                  <tr key={m.month} className="text-slate-800 dark:text-slate-200">
                    <Td className="capitalize font-medium">{formatMonthEs(m.month)}</Td>
                    <Td>{m.classes_count}</Td>
                    <Td>{(m.total_minutes / 60).toFixed(1)} h</Td>
                    <Td className="font-semibold tabular-nums">
                      {moneyFromCents(m.amount_cents, m.currency)}
                    </Td>
                    <Td>
                      {m.paid ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Pagado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Pendiente
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Comisiones por conversión ── */}
      <CommissionSection userId={session.user.id} />

      <p className="text-xs text-slate-400 dark:text-slate-500 text-center pb-4">
        Las ganancias se calculan automáticamente al confirmar la duración de cada clase.
        Los pagos se procesan manualmente cada mes.
      </p>
    </main>
  );
}

const RANK_BADGES: Record<string, { emoji: string; label: string; color: string }> = {
  starter: { emoji: "🌱", label: "Starter", color: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300" },
  pro:     { emoji: "⭐", label: "Pro",     color: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  elite:   { emoji: "🔥", label: "Elite",   color: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  master:  { emoji: "👑", label: "Master",  color: "bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300" },
};

async function CommissionSection({ userId }: { userId: string }) {
  const sb = supabaseAdmin();

  const { data: userRow } = await sb
    .from("users")
    .select("rango")
    .eq("id", userId)
    .maybeSingle();
  const rango = (userRow as { rango: string } | null)?.rango ?? "starter";
  const badge = RANK_BADGES[rango] ?? RANK_BADGES.starter;

  const { data: rangoConfig } = await sb
    .from("config_rangos")
    .select("comision_pct")
    .eq("rol", "teacher")
    .eq("rango", rango)
    .maybeSingle();
  const pct = (rangoConfig as { comision_pct: number } | null)?.comision_pct ?? 5;

  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";
  const { data: comisiones } = await sb
    .from("comisiones")
    .select("id, monto_cents, moneda, base_amount_cents, comision_pct, created_at")
    .eq("usuario_id", userId)
    .eq("mes", currentMonth)
    .order("created_at", { ascending: false });

  const totalCents = (comisiones ?? []).reduce(
    (sum: number, c: { monto_cents: number }) => sum + c.monto_cents, 0
  );

  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Comisiones por conversion
        </h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
          {badge.emoji} {badge.label} · {pct}%
        </span>
      </div>

      {(comisiones ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Sin comisiones este mes. Cada alumno que conviertas genera una comision del {pct}% sobre cada pago.
        </p>
      ) : (
        <>
          <div className="mt-3 text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {(totalCents / 100).toFixed(2)} EUR
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <Th>Fecha</Th>
                  <Th>Pago base</Th>
                  <Th>%</Th>
                  <Th>Comision</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(comisiones as Array<{ id: string; monto_cents: number; moneda: string; base_amount_cents: number; comision_pct: number; created_at: string }>).map(c => (
                  <tr key={c.id} className="text-slate-800 dark:text-slate-200">
                    <Td>{new Date(c.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</Td>
                    <Td className="tabular-nums">{(c.base_amount_cents / 100).toFixed(2)} EUR</Td>
                    <Td>{c.comision_pct}%</Td>
                    <Td className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{(c.monto_cents / 100).toFixed(2)} EUR</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ── Gráfico de barras: Ganancias ── */

type MonthData = {
  month: string;
  amount_cents: number;
  total_minutes: number;
  classes_count: number;
  currency: string;
  paid: boolean;
};

function EarningsChart({ months, maxCents, currency }: {
  months: MonthData[];
  maxCents: number;
  currency: string;
}) {
  if (months.length === 0) return <p className="text-sm text-slate-400">Sin datos</p>;

  const W = 600;
  const H = 200;
  const padL = 60;
  const padR = 20;
  const padT = 10;
  const padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = Math.min(50, (chartW / months.length) * 0.6);
  const gap = chartW / months.length;
  const ceil = Math.ceil(maxCents / 100) * 100;

  const gridLines = 4;
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => Math.round((ceil / gridLines) * i));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-label="Gráfico de ganancias mensuales">
      {/* Grid lines */}
      {gridVals.map(v => {
        const y = padT + chartH - (v / ceil) * chartH;
        return (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="0.5" />
            <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" fontSize="9" fontFamily="system-ui">
              {(v / 100).toFixed(0)}€
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {months.map((m, i) => {
        const x = padL + gap * i + (gap - barW) / 2;
        const h = ceil > 0 ? (m.amount_cents / ceil) * chartH : 0;
        const y = padT + chartH - h;
        const shortMonth = new Date(m.month).toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
        return (
          <g key={m.month}>
            <rect
              x={x} y={y} width={barW} height={Math.max(h, 0)}
              rx={4}
              className={m.paid
                ? "fill-emerald-500 dark:fill-emerald-400"
                : "fill-brand-500 dark:fill-brand-400"}
            />
            {m.amount_cents > 0 && (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300" fontSize="9" fontWeight="600" fontFamily="system-ui">
                {(m.amount_cents / 100).toFixed(0)}€
              </text>
            )}
            <text x={x + barW / 2} y={H - padB + 14} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 capitalize" fontSize="10" fontFamily="system-ui">
              {shortMonth}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Gráfico de línea: Horas trabajadas ── */

function HoursChart({ months, maxHours }: {
  months: MonthData[];
  maxHours: number;
}) {
  if (months.length === 0) return <p className="text-sm text-slate-400">Sin datos</p>;

  const W = 600;
  const H = 160;
  const padL = 50;
  const padR = 20;
  const padT = 15;
  const padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const gap = months.length > 1 ? chartW / (months.length - 1) : chartW;
  const ceil = Math.ceil(maxHours / 5) * 5 || 5;

  const points = months.map((m, i) => {
    const x = padL + (months.length > 1 ? gap * i : chartW / 2);
    const hours = m.total_minutes / 60;
    const y = padT + chartH - (hours / ceil) * chartH;
    return { x, y, hours, month: m.month, classes: m.classes_count };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

  const gridLines = 3;
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => Math.round((ceil / gridLines) * i));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-label="Gráfico de horas trabajadas">
      {/* Grid */}
      {gridVals.map(v => {
        const y = padT + chartH - (v / ceil) * chartH;
        return (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="0.5" />
            <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" fontSize="9" fontFamily="system-ui">
              {v}h
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaPath} className="fill-sky-100 dark:fill-sky-500/10" />

      {/* Line */}
      <path d={linePath} fill="none" className="stroke-sky-500 dark:stroke-sky-400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Dots + labels */}
      {points.map(p => {
        const shortMonth = new Date(p.month).toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
        return (
          <g key={p.month}>
            <circle cx={p.x} cy={p.y} r={4} className="fill-sky-500 dark:fill-sky-400 stroke-white dark:stroke-slate-900" strokeWidth="2" />
            {p.hours > 0 && (
              <text x={p.x} y={p.y - 10} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300" fontSize="9" fontWeight="600" fontFamily="system-ui">
                {p.hours.toFixed(1)}h
              </text>
            )}
            <text x={p.x} y={H - padB + 14} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 capitalize" fontSize="10" fontFamily="system-ui">
              {shortMonth}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Componentes auxiliares ── */

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accent
      ? "bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30"
      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${accent ? "text-brand-700 dark:text-brand-300" : "text-slate-900 dark:text-slate-50"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</td>;
}
