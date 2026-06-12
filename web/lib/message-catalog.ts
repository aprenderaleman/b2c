/**
 * Catálogo de KINDS conocidos: nombre legible, descripción, dónde se
 * usa en código, lista de placeholders disponibles para editar.
 *
 * Esto es metadata de UI — el cuerpo editable vive en la tabla
 * message_templates. Si un kind aparece en lead_timeline pero NO está
 * aquí, la página lo muestra como "(desconocido)" y NO ofrece edición
 * hasta que se añada a este catálogo + se refactore el código para
 * usar el helper renderTemplate.
 */

export type KindCatalogEntry = {
  kind:         string;
  name:         string;
  description:  string;
  channel:      "whatsapp" | "email" | "both";
  placeholders: string[];                    // documentadas
  editable:     boolean;                     // ya cableado al template DB?
  codePath:     string;                      // dónde vive en código
};

export const KIND_CATALOG: KindCatalogEntry[] = [
  {
    kind:        "diagnostico_followup",
    name:        "Drip post-funnel (msgs #1-6)",
    description: "Cadena de 6 followups a leads que completaron el quiz pero NO agendaron clase de prueba. Disparada por /api/cron/diagnostico-followups cada 30 min.",
    channel:     "both",
    placeholders: ["firstName", "bookUrl", "testUrl"],
    editable:    false,
    codePath:    "web/app/api/cron/diagnostico-followups/route.ts (templates inline por nextN)",
  },
  {
    kind:        "trial_confirmation",
    name:        "Confirmación de clase de prueba",
    description: "Email + WA inmediato tras agendar trial vía /api/public/book-trial. La mejor tasa del sistema (33-39%).",
    channel:     "both",
    placeholders: ["firstName", "classDate", "teacherName", "joinUrl"],
    editable:    false,
    codePath:    "web/app/api/public/book-trial/route.ts",
  },
  {
    kind:        "email_only_nudge",
    name:        "Nudge a leads sin WhatsApp",
    description: "Drip agresivo para leads que NO dejaron número. Actualmente 0% respuesta — candidato a rediseño urgente.",
    channel:     "email",
    placeholders: ["firstName", "bookUrl"],
    editable:    false,
    codePath:    "web/app/api/cron/diagnostico-followups/route.ts → runEmailOnlyNudges()",
  },
  {
    kind:        "post_trial_followup",
    name:        "Post-clase con link de pago",
    description: "Mensaje que envía Gelfis tras marcar 'Asistió' con pack + tipo de pago. Lleva link de Stripe.",
    channel:     "both",
    placeholders: ["firstName", "objective", "packName", "packLink"],
    editable:    true,
    codePath:    "web/lib/admin-actions.ts → markTrialAttendedAwaitingConversion()",
  },
  {
    kind:        "bulk_pdf_reactivation",
    name:        "Reactivación con PDF gratis",
    description: "Drip a leads dormidos enviando un PDF gratuito por nivel. Caption del documento. 4.3% respuesta — sospechoso para WhatsApp anti-spam.",
    channel:     "whatsapp",
    placeholders: ["firstName", "level"],
    editable:    false,
    codePath:    "web/app/api/cron/bulk-pdf-reactivation/route.ts → waText()",
  },
  {
    kind:        "trial_confirmation_resend",
    name:        "Reenvío manual de confirmación",
    description: "Cuando Gelfis pulsa 'Reenviar confirmación' desde el panel del lead.",
    channel:     "whatsapp",
    placeholders: ["firstName", "classDate", "joinUrl"],
    editable:    false,
    codePath:    "web/app/api/admin/leads/[id]/resend-confirmation/route.ts",
  },
];

export function getCatalogEntry(kind: string): KindCatalogEntry | undefined {
  return KIND_CATALOG.find(k => k.kind === kind);
}
