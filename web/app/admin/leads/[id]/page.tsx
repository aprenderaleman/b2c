import { notFound } from "next/navigation";
import Link from "next/link";
import { getGelfisNotes, getLeadById, getTimeline } from "@/lib/dashboard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { DeleteLeadButton } from "@/components/admin/DeleteLeadButton";

export const dynamic = "force-dynamic";

// Timeline event types → Spanish label
const TIMELINE_LABELS: Record<string, string> = {
  system_message_sent:    "Mensaje enviado",
  lead_message_received:  "Mensaje del lead",
  status_change:          "Cambio de estado",
  agent_note:             "Nota del agente",
  gelfis_note:            "Nota de Gelfis",
  calendly_event:         "Evento Calendly",
  trial_reminder:         "Recordatorio de clase",
  conversion:             "Conversión",
  escalation:             "Escalado",
  send_failed:            "Envío fallido",
  whatsapp_read_receipt:  "WhatsApp leído",
};

export default async function LeadDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) notFound();

  const [timeline, notes] = await Promise.all([
    getTimeline(lead.id),
    getGelfisNotes(lead.id),
  ]);

  const waNumber = lead.whatsapp_normalized.replace("+", "");

  return (
    <main className="space-y-5">
      <Link href="/admin/leads" className="text-sm text-slate-500 hover:text-brand-600">
        ← Volver a todos los leads
      </Link>

      {/* Header */}
      <header className="rounded-3xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">{lead.name || "Lead sin nombre"}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600">
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-brand-600 hover:underline"
              >
                {lead.whatsapp_normalized}
              </a>
              <span>·</span>
              <span>{lead.language.toUpperCase()}</span>
              <span>·</span>
              <StatusBadge status={lead.status} />
            </div>
          </div>
          <LeadActions leadId={lead.id} status={lead.status} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEFT: funnel data + Gelfis notes */}
        <div className="space-y-5 lg:col-span-1">
          <Panel title="Datos del funnel">
            <Kv k="Creado"             v={new Date(lead.created_at).toLocaleString("es-ES")} />
            <Kv k="Origen"             v={lead.source} />
            <Kv k="Nivel de alemán"    v={lead.german_level} />
            <Kv k="Objetivo"           v={lead.goal} />
            <Kv k="Urgencia"           v={lead.urgency} />
            <Kv k="Presupuesto"        v={lead.budget ?? "—"} />
            <Kv k="Correo electrónico" v={lead.email ?? "—"} />
            <Kv k="Mensajes vistos"    v={String(lead.messages_seen_count)} />
            <Kv k="Seguimiento #"      v={String(lead.current_followup_number)} />
            <Kv k="Próximo contacto"   v={lead.next_contact_date ? new Date(lead.next_contact_date).toLocaleString("es-ES") : "—"} />
            <Kv k="Clase agendada"     v={lead.trial_scheduled_at ? new Date(lead.trial_scheduled_at).toLocaleString("es-ES") : "—"} />
            {lead.trial_zoom_link && <Kv k="Enlace de la clase" v={lead.trial_zoom_link} />}
            <Kv k="RGPD aceptado"      v={lead.gdpr_accepted ? `Sí · ${lead.gdpr_accepted_at ? new Date(lead.gdpr_accepted_at).toLocaleDateString("es-ES") : ""}` : "No"} />
          </Panel>

          <Panel title="Notas de Gelfis">
            <form
              action={`/api/admin/leads/${lead.id}/notes`}
              method="post"
              className="space-y-2"
            >
              <textarea
                name="note"
                required
                maxLength={2000}
                rows={3}
                placeholder="Añade una nota (nunca se borra)…"
                className="input-text"
              />
              <button type="submit" className="btn-primary text-sm">Añadir nota</button>
            </form>
            <ul className="mt-4 divide-y divide-slate-100">
              {notes.length === 0 && <li className="py-2 text-sm text-slate-500">Aún no hay notas.</li>}
              {notes.map((n) => (
                <li key={n.id} className="py-2">
                  <div className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString("es-ES")}</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.note}</div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        {/* RIGHT: timeline */}
        <div className="lg:col-span-2">
          <Panel title={`Historial (${timeline.length})`}>
            {timeline.length === 0
              ? <p className="text-sm text-slate-500">Aún no hay eventos.</p>
              : <ul className="divide-y divide-slate-100">
                  {timeline.map((e) => <TimelineItem key={e.id} entry={e} />)}
                </ul>}
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-900 text-right break-all">{v}</span>
    </div>
  );
}

function LeadActions({ leadId, status }: { leadId: string; status: string }) {
  const canConvert   = status !== "converted" && status !== "lost";
  const canReactivate = status === "needs_human";
  const canMarkLost  = status !== "lost";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {canConvert && (
        <form action={`/api/admin/leads/${leadId}/convert`} method="post">
          <button type="submit" className="text-xs font-medium rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100">
            Convertir
          </button>
        </form>
      )}
      {canReactivate && (
        <form action={`/api/admin/leads/${leadId}/reactivate`} method="post">
          <button type="submit" className="text-xs font-medium rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 hover:bg-blue-100">
            Reactivar seguimiento auto
          </button>
        </form>
      )}
      {canMarkLost && (
        <form action={`/api/admin/leads/${leadId}/lost`} method="post">
          <button type="submit" className="text-xs font-medium rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 hover:bg-slate-100">
            Marcar perdido
          </button>
        </form>
      )}
      <a
        href={`/api/admin/leads/${leadId}/export`}
        className="text-xs font-medium rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50"
        title="RGPD: descargar todos los datos de este lead"
      >
        Exportar (JSON)
      </a>
      <DeleteLeadButton leadId={leadId} />
    </div>
  );
}

function TimelineItem({ entry }: { entry: { timestamp: string; type: string; content: string; author: string } }) {
  const color: Record<string, string> = {
    system_message_sent:    "bg-emerald-50 text-emerald-700 border-emerald-200",
    lead_message_received:  "bg-blue-50    text-blue-700    border-blue-200",
    status_change:          "bg-slate-50   text-slate-700   border-slate-200",
    agent_note:             "bg-slate-50   text-slate-500   border-slate-200",
    gelfis_note:            "bg-orange-50  text-orange-700  border-orange-200",
    calendly_event:         "bg-violet-50  text-violet-700  border-violet-200",
    trial_reminder:         "bg-cyan-50    text-cyan-700    border-cyan-200",
    conversion:             "bg-emerald-50 text-emerald-700 border-emerald-200",
    escalation:             "bg-red-50     text-red-700     border-red-200",
    send_failed:            "bg-red-50     text-red-700     border-red-200",
    whatsapp_read_receipt:  "bg-slate-50   text-slate-500   border-slate-200",
  };
  const cls = color[entry.type] ?? "bg-slate-50 text-slate-500 border-slate-200";
  const label = TIMELINE_LABELS[entry.type] ?? entry.type;
  return (
    <li className="py-3">
      <div className="flex items-center gap-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{label}</span>
        <span className="text-slate-500">{entry.author}</span>
        <span className="ml-auto text-slate-400">{new Date(entry.timestamp).toLocaleString("es-ES")}</span>
      </div>
      <div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{entry.content}</div>
    </li>
  );
}
