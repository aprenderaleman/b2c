import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getCloserLeads } from "@/lib/closer-actions";
import { supabaseAdmin } from "@/lib/supabase";
import { CloserLeadsList, type LeadSemaforo } from "@/components/closer/CloserLeadsList";
import { getSemaforoBatch } from "@/lib/semaforo";

export const metadata = { title: "Mis leads · Closer" };

export default async function CloserLeadsPage() {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");
  const leads = await getCloserLeads(session.user.id);

  const teacherByLead: Record<string, string> = {};
  const leadIdsWithTrial = leads.filter(l => l.trial_scheduled_at).map(l => l.id);

  if (leadIdsWithTrial.length > 0) {
    const sb = supabaseAdmin();
    const { data: classRows } = await sb
      .from("classes")
      .select("lead_id, teacher:teachers!inner(users!inner(full_name, email))")
      .in("lead_id", leadIdsWithTrial)
      .eq("is_trial", true)
      .order("created_at", { ascending: false });

    type Row = {
      lead_id: string;
      teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
               Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
    };
    const flat = <T,>(x: T | T[] | null | undefined): T | null =>
      !x ? null : Array.isArray(x) ? x[0] ?? null : x;
    for (const r of (classRows ?? []) as Row[]) {
      if (teacherByLead[r.lead_id]) continue;
      const tw = flat(r.teacher);
      const u = tw ? flat(tw.users) : null;
      const name = (u?.full_name ?? u?.email ?? "").trim();
      if (name) {
        teacherByLead[r.lead_id] = name.split(/\s+/)[0];
      }
    }
  }

  // Semáforo global por lead — el borde de color de cada fila/card.
  const semaforos = await getSemaforoBatch(leads.map(l => l.id));
  const semaforoByLead: Record<string, LeadSemaforo> = {};
  for (const [id, s] of semaforos) {
    if (s.color === "fuera") continue;
    semaforoByLead[id] = { color: s.color, badge: s.badge, detalle: s.detalle };
  }

  return (
    <main className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Mis leads
      </h1>
      <CloserLeadsList leads={leads} teacherByLead={teacherByLead} semaforoByLead={semaforoByLead} />
    </main>
  );
}
