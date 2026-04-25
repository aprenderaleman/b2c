import Link from "next/link";
import {
  getLeadsNeedingHuman,
  getQuickStats,
  getStaleConversations,
  getTodaysTrials,
  type LeadRow,
} from "@/lib/dashboard";
import { computeRiskAlerts } from "@/lib/reports";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic"; // always fresh — this is the nerve-center

export default async function TodayView() {
  const [trials, needsHuman, stale, stats, risks] = await Promise.all([
    getTodaysTrials(),
    getLeadsNeedingHuman(),
    getStaleConversations(),
    getQuickStats(),
    computeRiskAlerts().catch(() => []),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Hoy</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">Lo que necesita tu atención ahora.</p>
      </header>

      {/* Quick stats */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Leads nuevos hoy"          value={stats.newLeadsToday}       emoji="🆕" />
        <StatCard label="Conversaciones activas"    value={stats.activeConversations} emoji="💬" />
        <StatCard label="Conversiones (7 días)"     value={stats.conversionsThisWeek} emoji="🎉" accent />
      </section>

      {/* Risk alerts (students at risk — low attendance, inactivity, etc.) */}
      {risks.length > 0 && (
        <Section title="🔔 Alertas de estudiantes" count={risks.length} tone="red">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {risks.slice(0, 5).map((a, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.subject}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{a.detail}</div>
                </div>
                {a.link && (
                  <Link href={a.link} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
                    Ver →
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {risks.length > 5 && (
            <Link
              href="/admin/reportes"
              className="mt-3 inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              Ver las {risks.length} alertas →
            </Link>
          )}
        </Section>
      )}

      {/* Trials today */}
      <Section title="📅 Clases de prueba agendadas para hoy" count={trials.length}>
        {trials.length === 0
          ? <EmptyState text="No hay clases de prueba en la agenda de hoy." />
          : <TrialList leads={trials} />}
      </Section>

      {/* Needs human */}
      <Section title="🚨 Requieren humano" count={needsHuman.length} tone="red">
        {needsHuman.length === 0
          ? <EmptyState text="Nadie está esperando por ti." />
          : <LeadList leads={needsHuman} />}
      </Section>

      {/* Stale */}
      <Section title="⏳ En conversación, sin movimiento > 48 h" count={stale.length} tone="amber">
        {stale.length === 0
          ? <EmptyState text="Todas las conversaciones activas están al día." />
          : <LeadList leads={stale} />}
      </Section>
    </main>
  );
}

// ──────────────────────────────────────────────────────────

function StatCard({ label, value, emoji, accent }: {
  label: string; value: number; emoji: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 ${accent
      ? "bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30"
      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">{label}</div>
        <div className="text-2xl" aria-hidden>{emoji}</div>
      </div>
      <div className={`mt-1 text-3xl font-bold ${accent
        ? "text-brand-700 dark:text-brand-300"
        : "text-slate-900 dark:text-slate-50"}`}>
        {value}
      </div>
    </div>
  );
}

function Section({
  title, count, children, tone,
}: {
  title: string; count: number; children: React.ReactNode; tone?: "red" | "amber";
}) {
  const badgeCls = tone === "red"
    ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300"
    : tone === "amber"
      ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300";
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
        {title}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls}`}>{count}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>;
}

function LeadList({ leads }: { leads: LeadRow[] }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {leads.map((l) => (
        <li key={l.id} className="py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
              {l.name || l.whatsapp_normalized || l.email || "—"}
            </Link>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {l.whatsapp_normalized ?? l.email ?? "—"} · {l.german_level ?? "—"} · {l.goal ?? "—"} · {l.language ?? "—"}
            </div>
          </div>
          <StatusBadge status={l.status} />
        </li>
      ))}
    </ul>
  );
}

function TrialList({ leads }: { leads: LeadRow[] }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {leads.map((l) => {
        const t = l.trial_scheduled_at ? new Date(l.trial_scheduled_at) : null;
        const timeLabel = t
          ? t.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
          : "—";
        return (
          <li key={l.id} className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{timeLabel}</span>
                <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                  {l.name || l.whatsapp_normalized || l.email || "—"}
                </Link>
                <StatusBadge status={l.status} />
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {(l.whatsapp_normalized ?? l.email ?? "—")} · {l.goal ?? "—"}
              </div>
            </div>
            <TrialActions leadId={l.id} />
          </li>
        );
      })}
    </ul>
  );
}

function TrialActions({ leadId }: { leadId: string }) {
  return (
    <div className="flex items-center gap-2">
      <form action={`/api/admin/leads/${leadId}/trial/attended`} method="post">
        <button type="submit" className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20">
          Asistió
        </button>
      </form>
      <form action={`/api/admin/leads/${leadId}/trial/absent`} method="post">
        <button type="submit" className="text-xs font-medium rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20">
          No asistió
        </button>
      </form>
    </div>
  );
}
