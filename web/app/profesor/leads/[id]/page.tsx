import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { getGelfisNotes } from "@/lib/dashboard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { fmtTrialDate } from "@/lib/closer-constants";
import { AddNoteInput } from "./AddNoteInput";
import { FollowupMessages } from "./FollowupMessages";
import { TeacherLeadActions } from "./TeacherLeadActions";
import { getLastContacts, fmtLastContact } from "@/lib/contacts";
import { RegistrarContactoButton } from "@/components/contacts/RegistrarContactoButton";
import { LeadContactsHistory } from "@/components/contacts/LeadContactsHistory";

// Meta del lead en lenguaje natural para los mensajes del profe
const META_LABEL: Record<string, string> = {
  work:            "conseguir un mejor trabajo",
  visa:            "tus trámites y tu visa",
  studies:         "tus estudios",
  exam:            "tu examen oficial",
  travel:          "tu meta con el alemán",
  already_in_dach: "desenvolverte en tu día a día",
};

/**
 * /profesor/leads/[id] — perfil del lead para el profesor (Gelfis
 * 2026-08-13). Perfil único: el profe ve TODAS las notas (suyas, de
 * Gelfis y del closer) y puede añadir nuevas. Solo accesible si el
 * lead agendó una clase de prueba con este profesor.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Lead · Profesor" };

export default async function TeacherLeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const { id: leadId } = await params;
  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) redirect("/profesor/leads");

  const sb = supabaseAdmin();

  // Guard: este profe tiene (al menos) un trial con este lead
  const { data: trials } = await sb
    .from("classes")
    .select("scheduled_at, status")
    .eq("teacher_id", teacher.id)
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: false })
    .limit(1);

  const myTrial = (trials ?? [])[0] as { scheduled_at: string; status: string } | undefined;
  if (!myTrial) redirect("/profesor/leads");

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, created_at, german_level, goal, language, landing_intent, qualification_answers, reserva_prioritaria, priority_deadline, deposit_intent_at, trial_attended_at, trial_absent_at, closer_id")
    .eq("id", leadId)
    .single();

  if (!lead) redirect("/profesor/leads");

  // ── Notas unificadas: Gelfis + profes (timeline) + closer (acciones) ──
  const [gelfisNotes, teacherNotesRes, closerNotesRes] = await Promise.all([
    getGelfisNotes(leadId),
    sb
      .from("lead_timeline")
      .select("id, author, content, timestamp")
      .eq("lead_id", leadId)
      .eq("type", "teacher_note")
      .order("timestamp", { ascending: false })
      .limit(50),
    sb
      .from("acciones_closer")
      .select("id, contenido, created_at")
      .eq("lead_id", leadId)
      .eq("tipo", "nota")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  let closerName = "Closer";
  if (lead.closer_id) {
    const { data: closerUser } = await sb
      .from("users").select("full_name").eq("id", lead.closer_id).maybeSingle();
    closerName = (closerUser?.full_name ?? "Closer").split(/\s+/)[0];
  }

  const notes = [
    ...(teacherNotesRes.data ?? []).map((n) => ({
      id: `tl-${n.id}`, author: (n.author as string) || "Profe",
      content: n.content as string, createdAt: n.timestamp as string,
    })),
    ...gelfisNotes.map((n) => ({
      id: `gn-${n.id}`, author: "Gelfis", content: n.note, createdAt: n.created_at,
    })),
    ...(closerNotesRes.data ?? []).filter((a) => a.contenido).map((a) => ({
      id: `ac-${a.id}`, author: closerName, content: a.contenido as string, createdAt: a.created_at as string,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const lastContact = (await getLastContacts([lead.id])).get(lead.id) ?? null;

  const phoneDigits = lead.whatsapp_normalized?.replace(/\D/g, "") ?? "";
  const attendance = lead.trial_attended_at
    ? { label: "✓ Asistió", cls: "text-emerald-600 dark:text-emerald-400" }
    : lead.trial_absent_at
      ? { label: "✗ No asistió", cls: "text-red-600 dark:text-red-400" }
      : { label: "Clase pendiente", cls: "text-slate-500 dark:text-slate-400" };
  const q = summarizeQualification(lead.qualification_answers);

  return (
    <main className="space-y-5">
      <Link
        href="/profesor/leads"
        className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
      >
        &larr; Mis leads
      </Link>

      {/* Header */}
      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2 flex-wrap">
          {lead.name ?? "Lead"}
          <PriorityBadges flags={{
            reservaPrioritaria: lead.reserva_prioritaria,
            priorityDeadline:   lead.priority_deadline,
            depositIntentAt:    lead.deposit_intent_at,
          }} />
        </h1>
        <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
          {phoneDigits ? (
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              💬 {lead.whatsapp_normalized}
            </a>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 italic">sin WhatsApp</span>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="font-mono text-brand-600 dark:text-brand-400 hover:underline">
              {lead.email}
            </a>
          )}
          {lead.german_level && <span>Nivel <strong>{lead.german_level}</strong></span>}
          <StatusBadge status={lead.status} />
        </div>
        {q && (
          <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-300">
            📋 {q}
          </div>
        )}
        <div className="mt-3 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Clase de prueba contigo: </span>
          <strong className="text-slate-900 dark:text-slate-100">{fmtTrialDate(myTrial.scheduled_at)}</strong>
          <span className={`ml-2 font-medium ${attendance.cls}`}>{attendance.label}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            Último contacto: <strong className="text-slate-800 dark:text-slate-200">{fmtLastContact(lastContact)}</strong>
          </span>
          <RegistrarContactoButton leadId={lead.id} />
        </div>
      </header>

      {/* Acciones — las mismas del closer, con los endpoints del profe */}
      {lead.status !== "converted" && (
        <TeacherLeadActions
          leadId={lead.id}
          leadName={lead.name ?? "Lead"}
          leadEmail={lead.email}
          leadPhone={lead.whatsapp_normalized}
          leadLanguage={lead.language === "de" ? "de" : "es"}
          leadGermanLevel={lead.german_level}
          leadGoal={lead.goal}
        />
      )}

      {/* Mensajes de seguimiento del profe */}
      <FollowupMessages
        leadFirstName={(lead.name ?? "").trim().split(/\s+/)[0] || ""}
        whatsapp={lead.whatsapp_normalized}
        estado={lead.trial_attended_at ? "asistio" : lead.trial_absent_at ? "no_asistio" : "pendiente"}
        metaLabel={META_LABEL[lead.goal ?? ""] ?? "tu meta con el alemán"}
        trialTime={new Date(myTrial.scheduled_at).toLocaleTimeString("es-ES", {
          timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
        })}
      />

      {/* Notas unificadas */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Notas{notes.length > 0 ? ` (${notes.length})` : ""}
        </h2>
        <div className="mt-3">
          {notes.length > 0 ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {notes.map((n) => (
                <li key={n.id} className="py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">{n.author}</span>
                    <span className="ml-auto text-slate-400 dark:text-slate-500">
                      {new Date(n.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{n.content}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500 italic">Aún no hay notas.</p>
          )}
        </div>
      </section>

      {/* Agregar nota */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Agregar nota
        </h2>
        <AddNoteInput leadId={lead.id} />
      </section>

      <LeadContactsHistory leadId={lead.id} />
    </main>
  );
}
