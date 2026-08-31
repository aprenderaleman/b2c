import { getLeadContactsHistory } from "@/lib/contacts";
import { formatBerlinShort } from "@/lib/time";

/**
 * Historial completo de lead_contacts para la ficha del lead. Server
 * component compartido por las fichas de setter, admin, closer y profe —
 * cada contacto muestra quién fue (rol etiquetado, "Setter" incluido),
 * canal, acción y la nota.
 */

const ACTOR_LABEL: Record<string, string> = {
  closer: "Closer",
  profesor: "Profesor",
  admin: "Admin",
  stiv: "Stiv",
  lead: "Lead",
  setter: "Setter",
};

const ACTION_LABEL: Record<string, string> = {
  agendar_prueba: "Reagendó cita",
  no_contesto: "No contestó",
  enviar_info: "Envió info",
  enviar_propuesta: "Envió propuesta",
  seguimiento_pactado: "Seguimiento pactado",
  enviar_enlace: "Envió enlace de pago",
  confirmar_pago: "Pago confirmado",
  reactivacion: "Reactivación",
  asistio: "Asistió",
  no_show: "No asistió",
  feedback_profesor: "Feedback del profe",
  confirmar_cita: "Confirmó cita",
  recordatorio_cita: "Recordatorio de cita",
  nota_libre: "Nota",
  mensaje_stiv: "Mensaje automático",
  mensaje_lead: "Mensaje del lead",
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", llamada: "Llamada", email: "Email", aula: "Aula", otro: "Otro",
};

function actorBadgeClass(actorType: string): string {
  switch (actorType) {
    case "setter":
      return "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300";
    case "closer":
      return "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "profesor":
      return "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "lead":
      return "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300";
    default:
      return "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
  }
}

export async function LeadContactsHistory({
  leadId,
  title = "Historial de contactos",
  limit = 60,
}: {
  leadId: string;
  title?: string;
  limit?: number;
}) {
  const rows = await getLeadContactsHistory(leadId, limit);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
        {title} <span className="font-normal text-slate-400">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Sin contactos registrados todavía.</p>
      ) : (
        <ul className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
          {rows.map((c) => (
            <li key={c.id} className="text-sm border-b border-slate-100 dark:border-slate-800 pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${actorBadgeClass(c.actor_type)}`}>
                  {ACTOR_LABEL[c.actor_type] ?? c.actor_type}
                </span>
                {c.actor_name && (
                  <span className="font-medium text-slate-800 dark:text-slate-200">{c.actor_name}</span>
                )}
                <span className="text-slate-500 dark:text-slate-400">
                  {c.direction === "entrante" ? "←" : "→"} {ACTION_LABEL[c.action_type] ?? c.action_type}
                  {" · "}{CHANNEL_LABEL[c.channel] ?? c.channel}
                </span>
                <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                  {formatBerlinShort(c.occurred_at)}
                </span>
              </div>
              {c.note && (
                <p className="mt-1 text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{c.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
