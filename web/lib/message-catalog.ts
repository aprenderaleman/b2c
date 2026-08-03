/**
 * Catálogo de KINDS conocidos: nombre legible, descripción, dónde se
 * usa en código, lista de placeholders disponibles para editar.
 *
 * Soporta sub_n: un mismo kind puede tener varios mensajes distintos
 * en una cadena (#1, #2, ...). Cada uno editable por separado.
 *
 * Esto es metadata de UI — el cuerpo editable vive en message_templates.
 */

/**
 * REGLAS DE AUTORÍA DE COPIES (Gelfis 2026-08-01) — vinculantes.
 *
 * Cualquier copy nuevo o editado debe cumplir estas reglas. La UI de
 * /admin/mensajes las muestra como banner permanente.
 */
export const AUTHORING_RULES = [
  {
    id: "no_scarcity",
    title: "Prohibida la escasez inventada",
    body:
      "No mencionar cupos que se agotan, cierres de inscripciones, " +
      "'vamos a liberar tu plaza' ni ningún límite artificial. " +
      "Toda urgencia debe salir de variables reales: {dia_bonus} " +
      "(con lógica vivo/vencido resuelta por el motor), {fecha_llegada} " +
      "(fecha proyectada real del objetivo del lead).",
  },
  {
    id: "no_exit_binary",
    title: "Prohibidos los binarios de salida",
    body:
      "No pedir al lead que responda 'NO' para salir de una cadena, " +
      "ni forzarlo a elegir SÍ/NO. Ofrecer siempre una salida positiva " +
      "sin fricción (link para actuar) y dejar que el silencio hable.",
  },
  {
    id: "handlers_no_send",
    title: "Handlers NUNCA envían mensajes",
    body:
      "Los handlers de acciones (botones de profe/closer/admin) NUNCA " +
      "envían mensajes directamente — solo arrancan o cierran cadenas. " +
      "Todo envío sale del chain-processor o de un cron con las " +
      "protecciones del wrapper (kill switch, blocklist, rate limit, " +
      "gate nocturno, cap diario). Lección del incidente de dobles " +
      "convertida en ley de código.",
  },
  {
    id: "transactional_vs_conversational",
    title: "Transaccional = inmediato · Conversacional = con aire",
    body:
      "Solo son transaccionales (envío inmediato garantizado): " +
      "confirmación de trial (T+0), enlace de pago tras venta, " +
      "cancelaciones. El resto va con delay del chain-processor " +
      "(T+20min para chain4_absent, T+2h para asistió/objeción, etc.). " +
      "El lag deliberado suele convertir mejor que el instantáneo.",
  },
  {
    id: "single_source",
    title: "Fuente única de verdad",
    body:
      "Los copies de las cadenas 1/2/3/4/6/8x viven en `message_templates` " +
      "en BD (editables via /admin/mensajes). Los kinds inline en código " +
      "TS solo son legítimos para transacciones instantáneas o cuando el " +
      "flow es 1-shot (sin cadena). Ver docs/wa-chains-vs-legacy.md.",
  },
] as const;

export type KindCatalogEntry = {
  kind:         string;
  sub_n:        number | null;          // null = único mensaje del kind
  name:         string;
  description:  string;
  channel:      "whatsapp" | "email" | "both";
  placeholders: string[];
  editable:     boolean;
  codePath:     string;
};

export const KIND_CATALOG: KindCatalogEntry[] = [
  // ─── trial_confirmation (la mejor tasa del sistema 33-39%) ───
  {
    kind: "trial_confirmation", sub_n: null,
    name: "Confirmación de clase de prueba",
    description: "Email + WA inmediato tras agendar trial. La mejor tasa del sistema. NO tocar sin probar.",
    channel: "both", placeholders: ["firstName", "classDate", "teacherName", "joinUrl"],
    editable: false,
    codePath: "web/app/api/public/book-trial/route.ts",
  },

  // ─── post_trial_followup (cierre con link de pago) ───
  {
    kind: "post_trial_followup", sub_n: null,
    name: "Post-clase con link de pago",
    description: "Tras marcar 'Asistió' con pack + tipo de pago, envía el link de Stripe.",
    channel: "whatsapp", placeholders: ["firstName", "objective", "packName", "packLink"],
    editable: true,
    codePath: "web/lib/admin-actions.ts → markTrialAttendedAwaitingConversion()",
  },

  // ─── diagnostico_followup (drip de 6 msgs) ───
  // Welcome — el primero, MÁS importante. 1ª impresión.
  {
    kind: "diagnostico_followup", sub_n: 1,
    name: "Drip post-funnel · Msg #1 (welcome)",
    description: "Welcome a leads que terminaron el quiz pero no agendaron. T+15min. WA + Email.",
    channel: "both", placeholders: ["firstName", "bookUrl"],
    editable: true,
    codePath: "web/app/api/cron/diagnostico-followups/route.ts (nextN===1)",
  },
  {
    kind: "diagnostico_followup", sub_n: 2,
    name: "Drip post-funnel · Msg #2 (PDF gratis)",
    description: "T+24h: PDF gratuito por nivel + email con adjunto. Regalo de valor.",
    channel: "both", placeholders: ["firstName", "level"],
    editable: false,
    codePath: "web/app/api/cron/diagnostico-followups/route.ts (nextN===2)",
  },
  {
    kind: "diagnostico_followup", sub_n: 3,
    name: "Drip post-funnel · Msg #3 (test de nivel)",
    description: "T+2d: invita al test de nivel gratis en SCHULE.",
    channel: "whatsapp", placeholders: ["firstName", "testUrl"],
    editable: true,
    codePath: "web/app/api/cron/diagnostico-followups/route.ts (nextN===3)",
  },
  {
    kind: "diagnostico_followup", sub_n: 4,
    name: "Drip post-funnel · Msg #4 (follow-up test)",
    description: "T+3d (24h tras el test): '¿descubriste tu nivel?'",
    channel: "both", placeholders: ["firstName", "bookUrl"],
    editable: true,
    codePath: "web/app/api/cron/diagnostico-followups/route.ts (nextN===4)",
  },
  {
    kind: "diagnostico_followup", sub_n: 5,
    name: "Drip post-funnel · Msg #5 (última llamada WA)",
    description: "T+5d: última llamada por WhatsApp.",
    channel: "whatsapp", placeholders: ["firstName", "bookUrl"],
    editable: true,
    codePath: "web/app/api/cron/diagnostico-followups/route.ts (nextN===5)",
  },
  {
    kind: "diagnostico_followup", sub_n: 6,
    name: "Drip post-funnel · Msg #6 (email final)",
    description: "T+8d: email final. Tras este el lead pasa a 'cold'.",
    channel: "email", placeholders: ["firstName"],
    editable: false,
    codePath: "web/app/api/cron/diagnostico-followups/route.ts (nextN===6)",
  },

  // ─── email_only_nudge (drip 5 msgs · 0% RESPUESTA — rediseñar) ───
  {
    kind: "email_only_nudge", sub_n: 1,
    name: "Email-only · Nudge #1 (T+30min)",
    description: "⚠️ TASA 0%. Lead saltó WA; este email INSISTE en WA — error de UX. Rediseñar dándole vía email-only.",
    channel: "email", placeholders: ["firstName", "funnelUrl"],
    editable: true,
    codePath: "web/lib/email/templates/email-only-nudge.ts",
  },
  {
    kind: "email_only_nudge", sub_n: 2,
    name: "Email-only · Nudge #2 (T+6h)",
    description: "⚠️ TASA 0%. Misma trampa que #1.",
    channel: "email", placeholders: ["firstName", "funnelUrl"],
    editable: true,
    codePath: "web/lib/email/templates/email-only-nudge.ts",
  },
  {
    kind: "email_only_nudge", sub_n: 3,
    name: "Email-only · Nudge #3 (T+24h)",
    description: "⚠️ TASA 0%. Idem.",
    channel: "email", placeholders: ["firstName", "funnelUrl"],
    editable: true,
    codePath: "web/lib/email/templates/email-only-nudge.ts",
  },
  {
    kind: "email_only_nudge", sub_n: 4,
    name: "Email-only · Nudge #4 (T+3d)",
    description: "⚠️ TASA 0%. Idem.",
    channel: "email", placeholders: ["firstName", "funnelUrl"],
    editable: true,
    codePath: "web/lib/email/templates/email-only-nudge.ts",
  },
  {
    kind: "email_only_nudge", sub_n: 5,
    name: "Email-only · Nudge #5 (T+7d, última)",
    description: "⚠️ TASA 0%. Última llamada.",
    channel: "email", placeholders: ["firstName", "funnelUrl"],
    editable: true,
    codePath: "web/lib/email/templates/email-only-nudge.ts",
  },

  // ─── bulk_pdf_reactivation (4% — sospechoso anti-spam WA) ───
  {
    kind: "bulk_pdf_reactivation", sub_n: null,
    name: "Reactivación con PDF gratis",
    description: "Caption del documento PDF a leads dormidos. 4% respuesta — sospechoso para anti-spam.",
    channel: "whatsapp", placeholders: ["firstName", "level"],
    editable: false,
    codePath: "web/app/api/cron/bulk-pdf-reactivation/route.ts → waText()",
  },

  // ─── trial_confirmation_resend (reenvío manual) ───
  {
    kind: "trial_confirmation_resend", sub_n: null,
    name: "Reenvío manual de confirmación",
    description: "Cuando Gelfis pulsa 'Reenviar confirmación' desde el panel del lead.",
    channel: "whatsapp", placeholders: ["firstName", "classDate", "joinUrl"],
    editable: false,
    codePath: "web/app/api/admin/leads/[id]/resend-confirmation/route.ts",
  },
];

export function getCatalogEntry(kind: string, sub_n: number | null = null): KindCatalogEntry | undefined {
  return KIND_CATALOG.find(k => k.kind === kind && (k.sub_n ?? null) === (sub_n ?? null));
}
