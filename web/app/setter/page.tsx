import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getSetterQueue, type SetterQueueItem } from "@/lib/setter-queue";
import { getSetterScoreboard } from "@/lib/setter-metrics";
import { SetterScoreboardTiles } from "@/components/setter/SetterScoreboardTiles";
import { formatBerlinShort } from "@/lib/time";

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

      {queue.items.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          🎉 Cola vacía — nada pendiente de confirmar ni recuperar ahora mismo.
        </p>
      )}

      <QueueSection
        title="📞 Trials pendientes — buscar el CONFIRMO"
        hint="Aún no llega su clase. Llama lo antes posible: confirma y pregunta qué quiere lograr. La cita más próxima, primero."
        items={pendientes}
        snoozed={queue.snoozed.pendientes}
        empty="Todas las citas próximas están confirmadas ✅"
      />

      <QueueSection
        title="🔄 No asistieron — recuperar la agenda"
        hint="Llama y envíale el enlace de reagenda. El no-show más reciente, primero."
        items={noShows}
        snoozed={queue.snoozed.noShows}
        empty="No hay no-shows pendientes de recuperar."
      />
    </main>
  );
}

function QueueSection({
  title,
  hint,
  items,
  snoozed,
  empty,
}: {
  title: string;
  hint: string;
  items: SetterQueueItem[];
  snoozed: number;
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {title} <span className="text-slate-400 font-normal">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{empty}</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((it) => (
            <Link
              key={`${it.classId}-${it.tramo}`}
              href={`/setter/leads/${it.leadId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <span className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem]">
                {it.lead.name ?? "(sin nombre)"}
              </span>
              <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {it.citaTipo === "trial" ? "Clase de prueba" : "Sesión de plan"}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {formatBerlinShort(it.citaAt)}
                {it.hostName ? ` · ${it.hostName.split(/\s+/)[0]}` : ""}
              </span>
              {it.sinMarcar && (
                <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                  sin marcar
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {it.lastSetterContact
                  ? `Último toque: ${formatBerlinShort(it.lastSetterContact.occurred_at)}`
                  : "Sin contactar"}
              </span>
            </Link>
          ))}
        </div>
      )}

      {snoozed > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          ⏸️ {snoozed} en espera tras &quot;no contestó&quot; — vuelven solos a la lista (24h, o 2h antes de su clase).
        </p>
      )}
    </section>
  );
}
