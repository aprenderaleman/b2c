import { supabaseAdmin } from "./supabase";
import { buildPagoUrl } from "./enrollment-checkout";

/**
 * Shared loader for the trial-class lists shown to admin
 * (/admin/clasedeprueba) and teacher (/profesor/clasedeprueba).
 *
 * Pulls the booking row + the lead's contact info + the teacher's
 * display name. Returns rows pre-flattened so the page components
 * don't need to massage Supabase's nested-array shape.
 */

export type TrialClassRow = {
  classId:            string;
  scheduledAt:        string;
  durationMinutes:    number;
  status:             string;
  shortCode:          string | null;
  notesAdmin:         string | null;
  leadId:             string | null;
  leadName:           string | null;
  leadEmail:          string | null;
  leadWhatsapp:       string | null;
  leadLanguage:       "es" | "de" | null;
  leadGermanLevel:    string | null;
  leadGoal:           string | null;
  leadStatus:         string | null;
  leadConvertedToUserId: string | null;
  leadFirstNote:      string | null;
  leadFirstNoteAt:    string | null;
  leadFirstNoteAuthor:string | null;
  scriptTeacherNotes: string | null;
  scriptFinalOutcome: string | null;
  teacherId:          string;
  teacherName:        string;
  teacherEmail:       string;
  trialConfirmedAt:   string | null;
  voiceNoteSentAt:    string | null;
  // Meta Ads Paid funnel (2026-07-28)
  reservaPrioritaria: boolean | null;
  priorityDeadline:   string | null;
  depositIntentAt:    string | null;
  qualificationAnswers: { goal?: string; level?: string; deadline?: string } | null;
  landingIntent:      string | null;
  trialAttendedAt:    string | null;
  trialAbsentAt:      string | null;
  closerNotes:        Array<{ author: string; content: string; created_at: string }>;
  /** Última oferta enviada al lead (Jonathan 2026-11-07): el profe puede
   *  copiar el MISMO enlace que recibió el lead y reenviárselo. */
  lastOffer: { sentAt: string; label: string; url: string } | null;
};

/**
 * @param teacherId - if provided, scope to that teacher only.
 *                    Omit for the admin view (returns all trials).
 */
export async function listTrialClasses(teacherId?: string): Promise<TrialClassRow[]> {
  const sb = supabaseAdmin();

  let q = sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, status, short_code, notes_admin,
      teacher_id,
      teacher:teachers!classes_teacher_id_fkey!inner(users!inner(full_name, email)),
      lead:leads(id, name, email, whatsapp_normalized, language, german_level, goal, status, converted_to_user_id, trial_confirmed_at, trial_attended_at, trial_absent_at, reserva_prioritaria, priority_deadline, deposit_intent_at, qualification_answers, landing_intent),
      script:trial_class_scripts(teacher_notes, final_outcome, voice_note_sent_at)
    `)
    .eq("is_trial", true)
    // Filtro soft-delete (Gelfis 2026-07-10): las trials borradas por
    // /admin/classes/[id]/permanent quedan con deleted_at seteado y no
    // deben aparecer en /admin/clasedeprueba ni en /profesor/clasedeprueba.
    .is("deleted_at", null)
    // DESCENDENTE a propósito (Gelfis 2026-11-03): PostgREST devuelve
    // máximo 1.000 filas y la academia pasó de 1.000 trials — con orden
    // ascendente el tope cortaba justo las clases FUTURAS (el final de
    // la lista) y "Siguientes" salía vacío. En descendente el corte se
    // come solo el historial más antiguo. Abajo se re-invierte a
    // ascendente para que el resto del código no cambie.
    .order("scheduled_at", { ascending: false })
    .limit(1000);

  if (teacherId) q = q.eq("teacher_id", teacherId);

  const { data, error } = await q;
  if (error) throw error;
  // Re-invertir a ascendente (ver comentario del order de arriba).
  (data ?? []).reverse();

  type Raw = {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    short_code: string | null;
    notes_admin: string | null;
    teacher_id: string;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }>;
    lead: {
      id: string;
      name: string | null;
      email: string | null;
      whatsapp_normalized: string | null;
      language: "es" | "de" | null;
      german_level: string | null;
      goal: string | null;
      status: string | null;
      converted_to_user_id: string | null;
      trial_confirmed_at: string | null;
      trial_attended_at: string | null;
      trial_absent_at: string | null;
      reserva_prioritaria: boolean | null;
      priority_deadline: string | null;
      deposit_intent_at: string | null;
      qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
      landing_intent: string | null;
    } | Array<{
      id: string;
      name: string | null;
      email: string | null;
      whatsapp_normalized: string | null;
      language: "es" | "de" | null;
      german_level: string | null;
      goal: string | null;
      status: string | null;
      converted_to_user_id: string | null;
      trial_confirmed_at: string | null;
      trial_attended_at: string | null;
      trial_absent_at: string | null;
      reserva_prioritaria: boolean | null;
      priority_deadline: string | null;
      deposit_intent_at: string | null;
      qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
      landing_intent: string | null;
    }> | null;
    script: {
      teacher_notes: string | null;
      final_outcome: string | null;
      voice_note_sent_at: string | null;
    } | Array<{
      teacher_notes: string | null;
      final_outcome: string | null;
      voice_note_sent_at: string | null;
    }> | null;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  // Pre-fetch the FIRST agent_note per lead (typically the diagnostic
  // summary written by the funnel). Cheaper than nesting the join in
  // the main query and we de-dup by lead_id in memory.
  const leadIds = Array.from(
    new Set(
      (data ?? [])
        .map((r) => flat((r as Raw).lead)?.id)
        .filter((x): x is string => !!x),
    ),
  );
  // OJO (2026-11-07): .in() con ~1.000 ids revienta el límite de URL de
  // PostgREST ("Bad Request") y el error se tragaba en silencio. Todas
  // las consultas por leadIds van ahora en lotes de 150.
  const chunks = <T,>(arr: T[], size = 150): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const firstNoteByLead = new Map<string, { content: string; timestamp: string; author: string | null }>();
  // Última oferta enviada por lead → URL para el botón "Copiar enlace".
  // Individuales: si la fila es vieja (sin checkout_url, pre-migración
  // 152) la URL se reconstruye (/pago/<ofertaId>, determinista). Dúo y
  // Trío sin URL guardada se omiten: regenerar el /g/ cambiaría el grp.
  const lastOfferByLead = new Map<string, { sentAt: string; label: string; url: string }>();
  if (leadIds.length > 0) {
    const ofertas = (await Promise.all(chunks(leadIds).map(ids =>
      sb.from("ofertas_enviadas")
        .select("id, lead_id, meta, ritmo, tipo_pago, importe_cents, created_at, checkout_url")
        .in("lead_id", ids)
        .order("created_at", { ascending: false }),
    ))).flatMap(r => r.data ?? [])
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    for (const o of (ofertas ?? []) as Array<{
      id: string; lead_id: string; meta: string | null; ritmo: string | null;
      tipo_pago: string | null; importe_cents: number | null; created_at: string;
      checkout_url: string | null;
    }>) {
      if (lastOfferByLead.has(o.lead_id)) continue; // ya tenemos la más reciente
      const isGroup = /^(duo|trio)_/.test(o.ritmo ?? "");
      const url = o.checkout_url ?? (isGroup ? null : buildPagoUrl(o.id));
      if (!url) continue;
      // importe_cents: TOTAL del plan en ofertas individuales (también
      // suscripciones), pero €/mes/persona en Dúo/Trío.
      const eur = o.importe_cents != null
        ? `${Math.round(o.importe_cents / 100).toLocaleString("es-ES")} €${isGroup ? "/mes/persona" : " total"}`
        : "";
      const plan = isGroup
        ? `${o.ritmo!.startsWith("duo") ? "Dúo" : "Trío"} ${String(o.meta ?? "").toUpperCase()} ${o.ritmo!.split("_")[1] ?? ""}`
        : `${o.tipo_pago === "suscripcion" ? `Suscripción${o.ritmo ? ` ${o.ritmo}` : ""}` : "Pago único"} · Meta ${String(o.meta ?? "").toUpperCase()}`;
      lastOfferByLead.set(o.lead_id, { sentAt: o.created_at, label: `${plan}${eur ? ` · ${eur}` : ""}`, url });
    }
  }

  const closerNotesByLead = new Map<string, Array<{ author: string; content: string; created_at: string }>>();
  if (leadIds.length > 0) {
    const [notesParts, cNotesParts] = await Promise.all([
      Promise.all(chunks(leadIds).map(ids =>
        sb.from("lead_timeline")
          .select("lead_id, content, timestamp, author")
          .eq("type", "agent_note")
          .in("lead_id", ids)
          .order("timestamp", { ascending: true }),
      )),
      Promise.all(chunks(leadIds).map(ids =>
        sb.from("acciones_closer")
          .select("lead_id, contenido, created_at, closer_id")
          .eq("tipo", "nota")
          .not("contenido", "is", null)
          .in("lead_id", ids)
          .order("created_at", { ascending: false }),
      )),
    ]);
    const notes  = notesParts.flatMap(r => r.data ?? [])
      .sort((a, b) => ((a as { timestamp: string }).timestamp > (b as { timestamp: string }).timestamp ? 1 : -1));
    const cNotes = cNotesParts.flatMap(r => r.data ?? [])
      .sort((a, b) => ((a as { created_at: string }).created_at < (b as { created_at: string }).created_at ? 1 : -1));
    for (const n of (notes ?? []) as Array<{ lead_id: string; content: string; timestamp: string; author: string | null }>) {
      if (!firstNoteByLead.has(n.lead_id)) {
        firstNoteByLead.set(n.lead_id, { content: n.content, timestamp: n.timestamp, author: n.author });
      }
    }
    // Resolve closer names
    const closerIds = new Set((cNotes ?? []).map((n: Record<string, unknown>) => n.closer_id as string));
    const closerNameMap = new Map<string, string>();
    if (closerIds.size > 0) {
      const { data: users } = await sb.from("users").select("id, full_name").in("id", [...closerIds]);
      for (const u of (users ?? []) as Array<{ id: string; full_name: string | null }>) {
        closerNameMap.set(u.id, (u.full_name ?? "").split(/\s+/)[0] || "Closer");
      }
    }
    for (const n of (cNotes ?? []) as Array<{ lead_id: string; contenido: string; created_at: string; closer_id: string }>) {
      const list = closerNotesByLead.get(n.lead_id) ?? [];
      list.push({ author: closerNameMap.get(n.closer_id) ?? "Closer", content: n.contenido, created_at: n.created_at });
      closerNotesByLead.set(n.lead_id, list);
    }
  }

  return (data ?? []).map((r) => {
    const row = r as Raw;
    const teacherWrap = flat(row.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    const lead = flat(row.lead);
    const script = flat(row.script);
    const note = lead?.id ? firstNoteByLead.get(lead.id) ?? null : null;
    return {
      classId:         row.id,
      scheduledAt:     row.scheduled_at,
      durationMinutes: row.duration_minutes ?? 40,
      status:          row.status,
      shortCode:       row.short_code,
      notesAdmin:      row.notes_admin,
      leadId:          lead?.id ?? null,
      leadName:        lead?.name ?? null,
      leadEmail:       lead?.email ?? null,
      leadWhatsapp:    lead?.whatsapp_normalized ?? null,
      leadLanguage:    lead?.language ?? null,
      leadGermanLevel: lead?.german_level ?? null,
      leadGoal:        lead?.goal ?? null,
      leadStatus:      lead?.status ?? null,
      leadConvertedToUserId: lead?.converted_to_user_id ?? null,
      leadFirstNote:       note?.content ?? null,
      leadFirstNoteAt:     note?.timestamp ?? null,
      leadFirstNoteAuthor: note?.author ?? null,
      scriptTeacherNotes:  script?.teacher_notes ?? null,
      scriptFinalOutcome:  script?.final_outcome ?? null,
      teacherId:       row.teacher_id,
      teacherName:     tu?.full_name ?? tu?.email ?? "—",
      teacherEmail:    tu?.email ?? "",
      trialConfirmedAt: lead?.trial_confirmed_at ?? null,
      trialAttendedAt:  lead?.trial_attended_at ?? null,
      trialAbsentAt:    lead?.trial_absent_at ?? null,
      voiceNoteSentAt:  script?.voice_note_sent_at ?? null,
      reservaPrioritaria:  lead?.reserva_prioritaria ?? null,
      priorityDeadline:    lead?.priority_deadline ?? null,
      depositIntentAt:     lead?.deposit_intent_at ?? null,
      qualificationAnswers: lead?.qualification_answers ?? null,
      landingIntent:       lead?.landing_intent ?? null,
      closerNotes:         lead?.id ? closerNotesByLead.get(lead.id) ?? [] : [],
      lastOffer:           lead?.id ? lastOfferByLead.get(lead.id) ?? null : null,
    };
  });
}

export function partitionByTime(rows: TrialClassRow[]) {
  const now = Date.now();
  const upcoming: TrialClassRow[] = [];
  const past:     TrialClassRow[] = [];
  for (const r of rows) {
    const isFuture = new Date(r.scheduledAt).getTime() >= now;
    // Cancelled classes never count as "upcoming" — Calendly-style:
    // a cancelled future booking shouldn't push the real next class down.
    if (isFuture && r.status !== "cancelled") upcoming.push(r);
    else past.push(r);
  }
  // Past: newest first.
  past.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  return { upcoming, past };
}

/** Pretty Spanish weekday + date in Berlin TZ. */
export function formatBerlinDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "short",
  });
}

export function formatBerlinTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

/** Spanish-friendly status label. */
export function formatStatusEs(status: string): string {
  switch (status) {
    case "scheduled": return "Agendada";
    case "live":      return "En curso";
    case "completed": return "Completada";
    case "cancelled": return "Cancelada";
    default:          return status;
  }
}

/** Goal → label, mirrors the funnel options. */
export function formatGoalEs(goal: string | null): string {
  switch (goal) {
    case "work":            return "Trabajo";
    case "visa":            return "Visa";
    case "studies":         return "Estudios";
    case "exam":            return "Examen oficial";
    case "travel":          return "Viaje";
    case "already_in_dach": return "Ya en DACH";
    default:                return goal ?? "—";
  }
}
