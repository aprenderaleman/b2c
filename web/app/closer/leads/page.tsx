import { requireRole } from "@/lib/rbac";
import { getCloserLeads } from "@/lib/closer-actions";
import { CloserLeadsList } from "@/components/closer/CloserLeadsList";

export const metadata = { title: "Mis leads · Closer" };

export default async function CloserLeadsPage() {
  const session = await requireRole(["closer"]);
  const leads = await getCloserLeads(session.user.id);

  return (
    <main className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Mis leads
      </h1>
      <CloserLeadsList leads={leads} />
    </main>
  );
}
