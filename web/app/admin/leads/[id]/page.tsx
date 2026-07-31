import { notFound } from "next/navigation";
import Link from "next/link";
import { getGelfisNotes, getLeadById, getTimeline } from "@/lib/dashboard";
import { supabaseAdmin } from "@/lib/supabase";
import { formatBerlinFull } from "@/lib/time";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { LeadActions } from "@/components/admin/LeadActions";
import { ColdCallToggle } from "@/components/admin/ColdCallToggle";
import { WaQuickActions } from "@/components/admin/WaQuickActions";
import { RescheduleTrialButton } from "./RescheduleTrialButton";
import { AssignCloserButton } from "./AssignCloserButton";

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

  // If the lead has been converted, resolve the student_id so the
  // "Ver estudiante →" link on <LeadActions> can link to it directly.
  let studentId: string | null = null;
  if (lead.converted_to_user_id) {
    const { data } = await supabaseAdmin()
      .from("students")
      .select("id")
      .eq("user_id", lead.converted_to_user_id)
      .maybeSingle();
    studentId = (data?.id as string | null) ?? null;
  }

  // Leads booked via the new self-book funnel may have NO WhatsApp.
  // Fall back to email-only display when that's the case.
  const waNumber = lead.whatsapp_normalized?.replace("+", "") ?? null;

  // Single source of truth for the lead's upcoming trial: the
  // `classes` table. The legacy `leads.trial_scheduled_at` column
  // doesn't get cleared when a class is cancelled, so we ignore it
  // here and look up the soonest active scheduled trial. If multiple
  // exist (admin should never let this happen post-040 but historic
  // data may), we show the soonest and flag the duplicates.
  const sb = supabaseAdmin();
  const { data: trialRows } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, short_code, status, google_calendar_event_id")
    .eq("lead_id", lead.id)
    .eq("is_trial", true)
    .in("status", ["scheduled", "live", "completed"])
    .order("scheduled_at", { ascending: true });
  const activeTrial = (trialRows ?? []).find(c => c.status === "scheduled" || c.status === "live") ?? null;
  const trialCount  = (trialRows ?? []).filter(c => c.status === "scheduled" || c.status === "live").length;
  // Si el trial activo no tiene evento espejo en Google Calendar, mostramos
  // un banner con botón para recrearlo (caso Alice Redfern 2026-05-08).
  const trialMissingGcal = activeTrial && !(activeTrial as { google_calendar_event_id: string | null }).google_calendar_event_id;

  // Detectar si el WhatsApp de confirmación de trial falló y NO se ha
  // reenviado con éxito. Para activarlo: existe un send_failed con
  // kind=trial_confirmation y NO existe un system_message_sent
  // posterior con kind=trial_confirmation o kind=trial_confirmation_resend.
  // Caso real Juan José 2026-05-08 con doble +34.
  let waConfirmationFailed = false;
  if (activeTrial) {
    const { data: failures } = await sb.from("lead_timeline")
      .select("timestamp, metadata")
      .eq("lead_id", lead.id)
      .eq("type", "send_failed")
      .order("timestamp", { ascending: false });
    const lastFailure = (failures ?? []).find(r => {
      const meta = r.metadata as { kind?: string } | null;
      return meta?.kind === "trial_confirmation";
    });
    if (lastFailure) {
      const { data: succ } = await sb.from("lead_timeline")
        .select("metadata")
        .eq("lead_id", lead.id)
        .eq("type", "system_message_sent")
        .gte("timestamp", lastFailure.timestamp);
      const recovered = (succ ?? []).some(r => {
        const meta = r.metadata as { kind?: string; channel?: string } | null;
        return meta?.channel === "whatsapp" &&
          (meta.kind === "trial_confirmation" || meta.kind === "trial_confirmation_resend");
      });
      waConfirmationFailed = !recovered;
    }
  }

  return (
    <main className="space-y-5">
      <Link href="/admin/leads" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a todos los leads
      </Link>

      {/* Header */}
      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{lead.name || "Lead sin nombre"}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
              {waNumber ? (
                <a
                  href={`https://wa.me/${waNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {lead.whatsapp_normalized}
                </a>
              ) : lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {lead.email}
                </a>
              ) : (
                <span className="text-slate-400 dark:text-slate-500 italic">sin contacto</span>
              )}
              <span>·</span>
              <span>{(lead.language ?? "es").toUpperCase()}</span>
              <span>·</span>
              <span className="text-slate-500 dark:text-slate-400">{lead.source ?? "—"}</span>
              <span>·</span>
              <StatusBadge status={lead.status} />
              <PriorityBadges flags={{
                reservaPrioritaria: lead.reserva_prioritaria,
                priorityDeadline:   lead.priority_deadline,
                depositIntentAt:    lead.deposit_intent_at,
              }} />
            </div>
            {lead.motivo_inicial && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full
                              bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300
                              px-3 py-1 text-xs font-semibold">
                <span aria-hidden>🎯</span>
                {motivoInicialLabel(lead.motivo_inicial)}
              </div>
            )}
            {(() => {
              const q = summarizeQualification(lead.qualification_answers);
              if (!q) return null;
              return (
                <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Meta Ads Paid · </span>
                  {q}
                </div>
              );
            })()}
          </div>
          <div className="flex flex-col gap-2 items-end">
            <LeadActions
              lead={{
                id:                   lead.id,
                name:                 lead.name ?? "",
                email:                lead.email ?? null,
                phone:                lead.whatsapp_normalized ?? "",
                language:             (lead.language as "es" | "de") ?? "es",
                german_level:         lead.german_level ?? "",
                goal:                 lead.goal ?? null,
                status:               lead.status,
                converted_to_user_id: (lead as { converted_to_user_id?: string | null }).converted_to_user_id ?? null,
                student_id:           studentId,
                ai_paused_until:      (lead as { ai_paused_until?: string | null }).ai_paused_until ?? null,
                has_trial:            (trialRows ?? []).length > 0,
              }}
            />
            {lead.status !== "converted" && (
              <AssignCloserButton
                leadId={lead.id}
                currentCloserId={(lead as { closer_id?: string | null }).closer_id ?? null}
              />
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEFT: funnel data + Gelfis notes */}
        <div className="space-y-5 lg:col-span-1">
          <Panel title="Datos del funnel">
            <Kv k="Creado"             v={new Date(lead.created_at).toLocaleString("es-ES")} />
            <Kv k="Origen"             v={lead.source ?? "—"} />
            <Kv k="Nivel de alemán"    v={lead.german_level ?? "—"} />
            <Kv k="Objetivo"           v={lead.goal ?? "—"} />
            <Kv k="Urgencia"           v={lead.urgency ?? "—"} />
            <Kv k="Presupuesto"        v={lead.budget ?? "—"} />
            <Kv k="Correo electrónico" v={lead.email ?? "—"} />
            <Kv k="Mensajes vistos"    v={String(lead.messages_seen_count)} />
            <Kv k="Seguimiento #"      v={String(lead.current_followup_number)} />
            <Kv k="Próximo contacto"   v={lead.next_contact_date ? new Date(lead.next_contact_date).toLocaleString("es-ES") : "—"} />
            <Kv
              k="Clase agendada"
              v={activeTrial
                ? formatBerlinFull(activeTrial.scheduled_at as string, (lead.language as "es" | "de") ?? "es")
                : "—"
              }
            />
            {trialCount > 1 && (
              <Kv k="⚠ Atención" v={`Hay ${trialCount} clases activas — cancela las duplicadas.`} />
            )}
            {activeTrial && (
              <Kv k="Enlace de la clase" v={`/c/${activeTrial.short_code}`} />
            )}
            {activeTrial && (
              <div className="mt-3">
                <RescheduleTrialButton
                  leadId={lead.id}
                  classId={activeTrial.id as string}
                  currentScheduledAtIso={activeTrial.scheduled_at as string}
                  currentScheduledLabel={formatBerlinFull(
                    activeTrial.scheduled_at as string,
                    (lead.language as "es" | "de") ?? "es",
                  )}
                />
              </div>
            )}
            {trialMissingGcal && (
              <div className="mt-2 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs">
                <p className="font-semibold text-amber-800 dark:text-amber-200">
                  ⚠ Esta clase no tiene evento en tu Google Calendar
                </p>
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  El espejo en Calendar falló al reservar. Pulsa el botón para crearlo ahora.
                </p>
                <form action={`/api/admin/classes/${activeTrial.id}/gcal-create`} method="post" className="mt-2">
                  <button type="submit" className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5">
                    📅 Crear evento en Calendar
                  </button>
                </form>
              </div>
            )}
            {waConfirmationFailed && (
              <div className="mt-2 rounded-xl border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 p-3 text-xs">
                <p className="font-semibold text-red-800 dark:text-red-200">
                  ⚠ El lead NO ha recibido la confirmación por WhatsApp
                </p>
                <p className="mt-1 text-red-700 dark:text-red-300">
                  El envío inicial falló (número inválido, Evolution caída, etc.) y todavía no se ha reenviado.
                  Pulsa <strong>💬 Reenviar confirmación</strong> en la barra de acciones para enviarlo ahora.
                </p>
              </div>
            )}
            <Kv k="RGPD aceptado"      v={lead.gdpr_accepted ? `Sí · ${lead.gdpr_accepted_at ? new Date(lead.gdpr_accepted_at).toLocaleDateString("es-ES") : ""}` : "No"} />
            <div className="mt-4">
              <ColdCallToggle
                leadId={lead.id}
                coldCallDoneAt={(lead as { cold_call_done_at?: string | null }).cold_call_done_at ?? null}
              />
            </div>
          </Panel>

          {lead.whatsapp_normalized && (
            <WaQuickActions
              leadName={lead.name ?? ""}
              phoneE164={lead.whatsapp_normalized}
              language={(lead.language as "es" | "de") ?? "es"}
              trial={activeTrial ? {
                scheduledAt: activeTrial.scheduled_at as string,
                shortCode:   (activeTrial.short_code as string | null) ?? null,
              } : null}
            />
          )}

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
            <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {notes.length === 0 && <li className="py-2 text-sm text-slate-500 dark:text-slate-400">Aún no hay notas.</li>}
              {notes.map((n) => (
                <li key={n.id} className="py-2">
                  <div className="text-xs text-slate-500 dark:text-slate-400">{new Date(n.created_at).toLocaleString("es-ES")}</div>
                  <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{n.note}</div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        {/* RIGHT: timeline */}
        <div className="lg:col-span-2">
          <Panel title={`Historial (${timeline.length})`}>
            {timeline.length === 0
              ? <p className="text-sm text-slate-500 dark:text-slate-400">Aún no hay eventos.</p>
              : <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {timeline.map((e) => <TimelineItem key={e.id} entry={e} />)}
                </ul>}
          </Panel>
        </div>
      </div>
    </main>
  );
}

function motivoInicialLabel(m: NonNullable<Awaited<ReturnType<typeof getLeadById>>>["motivo_inicial"]): string {
  switch (m) {
    case "particulares": return "Clases particulares online";
    case "intensivo":    return "Curso intensivo online";
    case "certificado":  return "Certificado oficial (TELC, FIDE, Goethe)";
    case "profesional":  return "Alemán para trabajar";
    case "otro":         return "Otro motivo";
    default:             return "—";
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className="text-slate-900 dark:text-slate-100 text-right break-all">{v}</span>
    </div>
  );
}

function TimelineItem({ entry }: { entry: { timestamp: string; type: string; content: string; author: string } }) {
  const color: Record<string, string> = {
    system_message_sent:    "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
    lead_message_received:  "bg-blue-50    dark:bg-blue-500/10    text-blue-700    dark:text-blue-300    border-blue-200    dark:border-blue-500/30",
    status_change:          "bg-slate-50   dark:bg-slate-800      text-slate-700   dark:text-slate-300   border-slate-200   dark:border-slate-700",
    agent_note:             "bg-slate-50   dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700",
    gelfis_note:            "bg-orange-50  dark:bg-orange-500/10  text-orange-700  dark:text-orange-300  border-orange-200  dark:border-orange-500/30",
    calendly_event:         "bg-violet-50  dark:bg-violet-500/10  text-violet-700  dark:text-violet-300  border-violet-200  dark:border-violet-500/30",
    trial_reminder:         "bg-cyan-50    dark:bg-cyan-500/10    text-cyan-700    dark:text-cyan-300    border-cyan-200    dark:border-cyan-500/30",
    conversion:             "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
    escalation:             "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30",
    send_failed:            "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30",
    whatsapp_read_receipt:  "bg-slate-50   dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700",
  };
  const cls = color[entry.type] ?? "bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700";
  const label = TIMELINE_LABELS[entry.type] ?? entry.type;
  return (
    <li className="py-3">
      <div className="flex items-center gap-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{label}</span>
        <span className="text-slate-500 dark:text-slate-400">{entry.author}</span>
        <span className="ml-auto text-slate-400 dark:text-slate-500">{new Date(entry.timestamp).toLocaleString("es-ES")}</span>
      </div>
      <div className="mt-1 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{entry.content}</div>
    </li>
  );
}
