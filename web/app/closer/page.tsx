import { requireRole } from "@/lib/rbac";
import { getCloserQueue } from "@/lib/closer-semaforo";
import { CloserQueue } from "@/components/closer/CloserQueue";

export const metadata = { title: "Hoy · Closer" };
export const dynamic = "force-dynamic";

export default async function CloserHomePage() {
  const session = await requireRole(["closer"]);
  const items = await getCloserQueue(session.user.id);

  return (
    <main className="space-y-6">
      <CloserQueue items={items} />
    </main>
  );
}
