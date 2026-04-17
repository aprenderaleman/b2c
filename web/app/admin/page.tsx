import Link from "next/link";
import {
  getLeadsNeedingHuman,
  getQuickStats,
  getStaleConversations,
  getTodaysTrials,
  type LeadRow,
} from "@/lib/dashboard";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic"; // always fresh — this is the nerve-center

export default async function TodayView() {
  const [trials, needsHuman, stale, stats] = await Promise.all([
    getTodaysTrials(),
    getLeadsNeedingHuman(),
    getStaleConversations(),
    getQuickStats(),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Today</h1>
        <p className="text-slate-500 text-sm">What needs your attention right now.</p>
      </header>

      {/* Quick stats */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="New leads today"       value={stats.newLeadsToday}       emoji="🆕" />
        <StatCard label="Active conversations"  value={stats.activeConversations} emoji="💬" />
        <StatCard label="Conversions (7 days)"  value={stats.conversionsThisWeek} emoji="🎉" accent />
      </section>

      {/* Trials today */}
      <Section title="📅 Trial classes scheduled today" count={trials.length}>
        {trials.length === 0
          ? <EmptyState text="No trials on the calendar today." />
          : <TrialList leads={trials} />}
      </Section>

      {/* Needs human */}
      <Section title="🚨 Needs human" count={needsHuman.length} tone="red">
        {needsHuman.length === 0
          ? <EmptyState text="Nobody is waiting for you." />
          : <LeadList leads={needsHuman} />}
      </Section>

      {/* Stale */}
      <Section title="⏳ In conversation, no movement > 48h" count={stale.length} tone="amber">
        {stale.length === 0
          ? <EmptyState text="All active conversations are fresh." />
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
      ? "bg-brand-50 border-brand-200"
      : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">{label}</div>
        <div className="text-2xl" aria-hidden>{emoji}</div>
      </div>
      <div className={`mt-1 text-3xl font-bold ${accent ? "text-brand-700" : "text-slate-900"}`}>
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
    ? "bg-red-100 text-red-700"
    : tone === "amber"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600";
  return (
    <section className="rounded-3xl bg-white border border-slate-200 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        {title}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls}`}>{count}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-slate-500">{text}</p>;
}

function LeadList({ leads }: { leads: LeadRow[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {leads.map((l) => (
        <li key={l.id} className="py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-600">
              {l.name || l.whatsapp_normalized}
            </Link>
            <div className="text-xs text-slate-500">
              {l.whatsapp_normalized} · {l.german_level} · {l.goal} · {l.language}
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
    <ul className="divide-y divide-slate-100">
      {leads.map((l) => {
        const t = l.trial_scheduled_at ? new Date(l.trial_scheduled_at) : null;
        const timeLabel = t
          ? t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
          : "—";
        return (
          <li key={l.id} className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-slate-600">{timeLabel}</span>
                <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                  {l.name || l.whatsapp_normalized}
                </Link>
                <StatusBadge status={l.status} />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {l.whatsapp_normalized} · {l.goal}
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
        <button type="submit" className="text-xs font-medium rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100">
          Mark attended
        </button>
      </form>
      <form action={`/api/admin/leads/${leadId}/trial/absent`} method="post">
        <button type="submit" className="text-xs font-medium rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 hover:bg-amber-100">
          Mark absent
        </button>
      </form>
    </div>
  );
}
