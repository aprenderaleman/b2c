import { requireRole } from "@/lib/rbac";
import { getCloserTasks } from "@/lib/closer-cadence";
import { CloserDashboard } from "@/components/closer/CloserDashboard";

export const metadata = { title: "Hoy · Closer" };

export default async function CloserHomePage() {
  const session = await requireRole(["closer"]);
  const closerId = session.user.id;

  const [atrasadas, hoy, proximas] = await Promise.all([
    getCloserTasks(closerId, "atrasadas"),
    getCloserTasks(closerId, "hoy"),
    getCloserTasks(closerId, "proximas"),
  ]);

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Hoy
      </h1>
      <CloserDashboard
        atrasadas={atrasadas}
        hoy={hoy}
        proximas={proximas}
      />
    </main>
  );
}
