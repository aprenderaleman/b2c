import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getCloserLeads } from "@/lib/closer-actions";
import { LeadsList, type LeadItem, type LeadSemaforo, type LastContactInfo } from "@/components/leads/LeadsList";
import { getSemaforoBatch } from "@/lib/semaforo";
import { getLastContacts, fmtLastContact } from "@/lib/contacts";

export const metadata = { title: "Mis leads · Closer" };

/**
 * /closer/leads — la cola del closer (misma página compartida con el
 * profe: components/leads/LeadsList, cada rol con sus leads).
 */
export default async function CloserLeadsPage() {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");
  const leads = await getCloserLeads(session.user.id);

  // Semáforo global + último contacto — color, orden y referencia.
  const [semaforos, lastContacts] = await Promise.all([
    getSemaforoBatch(leads.map(l => l.id)),
    getLastContacts(leads.map(l => l.id)),
  ]);
  const semaforoByLead: Record<string, LeadSemaforo> = {};
  for (const [id, s] of semaforos) {
    if (s.color === "fuera") continue;
    semaforoByLead[id] = { color: s.color, badge: s.badge, detalle: s.detalle };
  }
  const lastContactByLead: Record<string, LastContactInfo> = {};
  for (const l of leads) {
    const c = lastContacts.get(l.id) ?? null;
    lastContactByLead[l.id] = { label: fmtLastContact(c), at: c?.occurred_at ?? null };
  }

  return (
    <main className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Mis leads
      </h1>
      <LeadsList
        role="closer"
        leads={leads as LeadItem[]}
        semaforoByLead={semaforoByLead}
        lastContactByLead={lastContactByLead}
      />
    </main>
  );
}
