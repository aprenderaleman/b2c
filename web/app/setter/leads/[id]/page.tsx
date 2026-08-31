import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { LeadContactsHistory } from "@/components/contacts/LeadContactsHistory";
import { SetterContactoButton } from "@/components/setter/SetterContactoButton";
import { SetterRescateButton } from "@/components/setter/SetterRescateButton";
import { CopyRescheduleLink } from "@/components/setter/CopyRescheduleLink";
import { formatBerlinFull } from "@/lib/time";

export const metadata = { title: "Lead · Setter" };
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const GOAL_LABEL: Record<string, string> = {
  work: "Trabajo", studies: "Estudios / Ausbildung", visa: "Visa / Nacionalidad",
  travel: "Mudanza / Viaje", family: "Familia", already_in_dach: "Vive en Alemania/Austria/Suiza",
};

/**
 * Ficha REDUCIDA del lead para el setter: nombre, teléfono, meta
 * declarada, citas e historial de contactos. Sin precios, propuestas,
 * pagos ni pipeline — a propósito.
 */
export default async function SetterLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  const { id: leadId } = await params;
  const sb = supabaseAdmin();

  const { data: leadRow } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, whatsapp_raw, german_level, goal, motivo_inicial, status, estado_cierre, trial_scheduled_at, trial_attended_at, trial_absent_at, sesion_plan_at")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) notFound();
  const lead = leadRow as {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; whatsapp_raw: string | null;
    german_level: string | null; goal: string | null; motivo_inicial: string | null;
    status: string; estado_cierre: string | null;
    trial_scheduled_at: string | null; trial_attended_at: string | null;
    trial_absent_at: string | null; sesion_plan_at: string | null;
  };

  // Ownership del setter: el lead debe tener al menos una cita.
  const { data: classesData } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, status, is_trial, sesion_closer_id, teacher_id")
    .eq("lead_id", leadId)
    .or("is_trial.eq.true,sesion_closer_id.not.is.null")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(5);
  const citas = (classesData ?? []) as Array<{
    id: string; scheduled_at: string; duration_minutes: number | null; status: string;
    is_trial: boolean; sesion_closer_id: string | null; teacher_id: string | null;
  }>;
  if (citas.length === 0) notFound();

  const phone = lead.whatsapp_normalized ?? lead.whatsapp_raw;
  const citaPrincipal = citas[0];
  const citaTipo: "trial" | "sesion" = citaPrincipal.sesion_closer_id ? "sesion" : "trial";
  const rescheduleLink = citaTipo === "sesion"
    ? `${PLATFORM_URL}/sesion-plan/funnel`
    : `${PLATFORM_URL}/agendar/cuando?lead=${leadId}&from=setter_reschedule`;

  const now = Date.now();

  return (
    <main className="space-y-5 max-w-3xl">
      <div>
        <Link href="/setter" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver a mi cola
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{lead.name ?? "(sin nombre)"}</h1>
            <div className="mt-1 space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
              {phone && (
                <p>
                  📞 <a href={`tel:${phone}`} className="hover:text-brand-600 dark:hover:text-brand-400 font-medium">{phone}</a>
                  {" · "}
                  <a
                    href={`https://wa.me/${phone.replace(/[^\d]/g, "")}`}
                    target="_blank" rel="noopener noreferrer"
                    className="hover:text-brand-600 dark:hover:text-brand-400"
                  >
                    WhatsApp ↗
                  </a>
                </p>
              )}
              <p>
                🎯 Meta: <span className="font-medium">{lead.goal ? (GOAL_LABEL[lead.goal] ?? lead.goal) : "—"}</span>
                {lead.motivo_inicial ? ` · Motivo: ${lead.motivo_inicial}` : ""}
                {lead.german_level ? ` · Nivel: ${lead.german_level}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SetterContactoButton leadId={leadId} />
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Citas</h2>
        <ul className="space-y-2">
          {citas.map((c) => {
            const pasada = new Date(c.scheduled_at).getTime() < now;
            const sinMarcar = pasada && c.status === "scheduled" && !lead.trial_attended_at && !lead.trial_absent_at;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {c.sesion_closer_id ? "Sesión de plan" : "Clase de prueba"}
                </span>
                <span className="text-slate-700 dark:text-slate-200">{formatBerlinFull(c.scheduled_at)}</span>
                {c.status === "cancelled" && <span className="text-xs text-slate-400">cancelada</span>}
                {sinMarcar && (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                    sin marcar
                  </span>
                )}
                {lead.trial_absent_at && pasada && c.status === "scheduled" && (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 font-medium">
                    no-show
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <SetterRescateButton leadId={leadId} classId={citaPrincipal.id} tipo={citaTipo} />
          <CopyRescheduleLink leadId={leadId} link={rescheduleLink} />
        </div>
      </section>

      <LeadContactsHistory leadId={leadId} />
    </main>
  );
}
