import { requireRole } from "@/lib/rbac";
import { getCloserTasks } from "@/lib/closer-cadence";
import { CloserInbox } from "@/components/closer/CloserInbox";

export const metadata = { title: "Inbox · Closer" };

export default async function CloserHomePage() {
  const session = await requireRole(["closer"]);
  const closerId = session.user.id;

  const tasks = await getCloserTasks(closerId, "pendientes");

  return (
    <main className="space-y-6">
      <CloserInbox tasks={tasks} />
    </main>
  );
}
