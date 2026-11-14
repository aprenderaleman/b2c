/**
 * Registro de confirmaciones de asistencia por parte del lead (Gelfis
 * 2026-11-14). Centralizado para que el setter (confirmó por teléfono),
 * la página pública /c/[code]/confirmar y un futuro webhook de respuesta
 * WA ("Sí/CONFIRMO") compartan la misma lógica.
 *
 * Idempotente: el campo classes.student_confirmed_at SÓLO se setea si
 * estaba NULL. Timeline y status_change solo se insertan en la 1ª vez.
 */

import { supabaseAdmin } from "./supabase";

export type ConfirmationSource = "setter_phone" | "student_web" | "student_wa_reply";

export async function recordStudentConfirmation(args: {
  classId: string;
  leadId:  string;
  source:  ConfirmationSource;
  /** Para setter_phone: nombre que aparece en el timeline. */
  actorName?: string;
}): Promise<{ ok: boolean; alreadyConfirmed?: boolean; confirmedAt?: string }> {
  const { classId, leadId, source, actorName } = args;
  const sb = supabaseAdmin();

  // Intentamos el UPDATE condicionado a student_confirmed_at IS NULL.
  // Idempotente: una segunda llamada no sobrescribe la fecha.
  const nowIso = new Date().toISOString();
  const { data: updated } = await sb
    .from("classes")
    .update({
      student_confirmed_at: nowIso,
      student_confirmed_source: source,
    })
    .eq("id", classId)
    .is("student_confirmed_at", null)
    .select("id, scheduled_at, student_confirmed_at")
    .maybeSingle();

  if (!updated) {
    // Ya estaba confirmada — devolvemos la fecha original.
    const { data: existing } = await sb
      .from("classes")
      .select("student_confirmed_at")
      .eq("id", classId)
      .maybeSingle();
    return {
      ok: true,
      alreadyConfirmed: true,
      confirmedAt: (existing as { student_confirmed_at?: string } | null)?.student_confirmed_at,
    };
  }

  // Timeline: constancia para admin y profe.
  const label: Record<ConfirmationSource, string> = {
    setter_phone:     `📞✅ Lead confirmó asistencia por teléfono${actorName ? ` (con ${actorName})` : ""}`,
    student_web:      "🖱️✅ Lead confirmó asistencia desde el enlace (web)",
    student_wa_reply: "💬✅ Lead confirmó asistencia por respuesta de WhatsApp",
  };
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "status_change",
    author:  source === "setter_phone" ? (actorName ?? "setter") : "lead",
    content: label[source],
    metadata: { kind: "student_confirmed", source, class_id: classId },
  }).then(() => {}, () => {});

  return { ok: true, alreadyConfirmed: false, confirmedAt: nowIso };
}
