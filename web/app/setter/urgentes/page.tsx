import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getSetterUrgentes } from "@/lib/setter-urgentes";
import { getSetterQueue } from "@/lib/setter-queue";
import { getSetterScoreboard } from "@/lib/setter-metrics";
import { SetterScoreboardTiles } from "@/components/setter/SetterScoreboardTiles";
import { SetterUrgentesTabs } from "@/components/setter/SetterUrgentesTabs";

export const metadata = { title: "Leads Urgentes · Setter" };
export const dynamic = "force-dynamic";

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "Último mes" },
  { days: 90, label: "3 meses" },
];

/**
 * Página única de trabajo del setter (consolidación 2026-11-24): absorbe
 * "Mi cola" — marcador, aviso de IBAN y la pestaña "No asistieron" viven
 * ahora aquí junto a Calientes / Hoy / Mañana. /setter redirige aquí.
 */
export default async function SetterUrgentesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter" && session.user.role !== "admin" && session.user.role !== "superadmin") {
    redirect("/");
  }

  const sp = await searchParams;
  const days = [7, 30, 90].includes(parseInt(sp.days ?? "", 10)) ? parseInt(sp.days!, 10) : 7;

  const sb = supabaseAdmin();
  const [urgentes, queue, scoreboard, perfilRes] = await Promise.all([
    getSetterUrgentes(),
    getSetterQueue(),
    getSetterScoreboard(days, session.user.id),
    sb.from("users").select("iban").eq("id", session.user.id).maybeSingle(),
  ]);
  const sinIban = session.user.role === "setter" &&
    !((perfilRes.data as { iban?: string | null } | null)?.iban);

  const noShows = queue.items.filter(it => it.tramo === "no_show");

  return (
    <main className="space-y-6">
      {sinIban && (
        <Link
          href="/setter/perfil"
          className="block rounded-2xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
        >
          💶 <strong>Falta tu IBAN para poder pagarte.</strong> Añádelo en tu
          perfil (1 minuto) — toca aquí.
        </Link>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Leads Urgentes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Recién agendados, citas de hoy y de mañana, y no-shows por recuperar — todo en un sitio.
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/setter/urgentes?days=${r.days}`}
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

      <SetterUrgentesTabs
        hoy={urgentes.hoy}
        manana={urgentes.manana}
        calientes={urgentes.calientes}
        noShows={noShows}
        snoozedNoShows={queue.snoozed.noShows}
        noShowBacklog={queue.noShowBacklog}
      />
    </main>
  );
}
