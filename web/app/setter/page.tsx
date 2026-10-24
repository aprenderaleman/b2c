import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getSetterQueue } from "@/lib/setter-queue";
import { getSetterScoreboard } from "@/lib/setter-metrics";
import { SetterScoreboardTiles } from "@/components/setter/SetterScoreboardTiles";
import { SetterQueueTabs } from "@/components/setter/SetterQueueTabs";

export const metadata = { title: "Mi cola · Setter" };
export const dynamic = "force-dynamic";

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "Último mes" },
  { days: 90, label: "3 meses" },
];

export default async function SetterColaPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  const sp = await searchParams;
  const days = [7, 30, 90].includes(parseInt(sp.days ?? "", 10)) ? parseInt(sp.days!, 10) : 7;

  const [queue, scoreboard] = await Promise.all([
    getSetterQueue(),
    getSetterScoreboard(days, session.user.id),
  ]);

  const pendientes = queue.items.filter(it => it.tramo === "pendiente");
  const noShows = queue.items.filter(it => it.tramo === "no_show");

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi cola</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Persigue el CONFIRMO de las citas pendientes y recupera a los que no asistieron.
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/setter?days=${r.days}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                days === r.days
                  ? "bg-brand-600 border-brand-600 text-white"
                  : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </header>

      <SetterScoreboardTiles s={scoreboard} />

      <SetterQueueTabs
        pendientes={pendientes}
        noShows={noShows}
        snoozed={queue.snoozed}
      />
    </main>
  );
}
