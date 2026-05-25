import { button, escapeHtml, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email "IMPORTANTE: Nuevo Lead" para Gelfis.
 *
 * Se dispara desde /api/public/diagnostico/register en cuanto un lead
 * completa el paso 5 del funnel. Objetivo: que Gelfis pueda contactar
 * al lead en <5 minutos.
 *
 * Diseño:
 *   - Banner rojo IMPORTANTE arriba del envelope estándar.
 *   - Datos del lead en bloque tabla.
 *   - Botón principal naranja: deep-link de WhatsApp con mensaje
 *     pre-rellenado, un solo toque y ya está escribiendo al lead.
 *   - Botón secundario: link al perfil completo del admin.
 *   - Estado de la clase de prueba (pendiente / agendada).
 *   - Timestamp + recordatorio del <5 min al final.
 */
export type LeadNewUrgentVars = {
  // Datos del lead (paso 5 del funnel completado)
  leadId:        string;
  fullName:      string;
  email:         string;
  whatsappE164:  string;            // ej. "+34611223344"
  country:       string;            // ISO-2
  language:      "es" | "de";
  motivoInicial: string | null;     // "particulares" | "intensivo" | ...
  motivoLabel:   string | null;     // ya legible: "Clases particulares"
  germanLevel:   string | null;     // "Cero / no sé nada" etc. (texto literal)
  goal:          string | null;     // "Trabajo" etc.
  urgency:       string | null;
  budget:        string | null;
  // Clase de prueba (paso 6 — opcional, casi nunca al momento del paso 5)
  trialStartIso: string | null;
  trialTeacher:  string | null;
  // URLs
  adminProfileUrl: string;          // https://b2c.aprender-aleman.de/admin/leads/<id>
};

export function renderLeadNewUrgent(v: LeadNewUrgentVars): RenderedEmail {
  const subject = `🚨 IMPORTANTE: Nuevo Lead — ${v.fullName}`;
  const firstName = (v.fullName ?? "").trim().split(/\s+/)[0] || v.fullName;
  const waDigits  = v.whatsappE164.replace(/\D/g, "");

  // Saludo pre-rellenado al hacer click en el botón "Escribir por WA".
  // Distinto según idioma del lead.
  const waPreText = v.language === "de"
    ? `Hallo ${firstName}, hier ist Stiv von Aprender-Aleman.de 👋 Wir haben deinen Probestunden-Antrag erhalten. Hast du eine kurze Frage?`
    : `Hola ${firstName}, soy Stiv de Aprender-Aleman.de 👋 Acabo de ver que has empezado a agendar tu clase de prueba. ¿Tienes alguna pregunta?`;
  const waUrl = `https://wa.me/${waDigits}?text=${encodeURIComponent(waPreText)}`;

  const trialBlock = v.trialStartIso
    ? (() => {
        const dt = new Date(v.trialStartIso!).toLocaleString("es-ES", {
          timeZone: "Europe/Berlin",
          weekday: "long", day: "numeric", month: "long",
          hour: "2-digit", minute: "2-digit",
        });
        return `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Clase de prueba</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(dt)} (Berlín)${v.trialTeacher ? `<br><span style="color:#64748b;font-size:12px;">con ${escapeHtml(v.trialTeacher)}</span>` : ""}</td></tr>`;
      })()
    : `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Clase de prueba</td><td style="padding:6px 0;color:#92400e;font-style:italic;">Pendiente · paso 6 del funnel</td></tr>`;

  const body = `
    ${/* Banner rojo IMPORTANTE */ ""}
    <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#ffffff;padding:18px 22px;border-radius:14px;margin-bottom:18px;text-align:center;">
      <div style="font-size:13px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;">🚨 IMPORTANTE</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">Nuevo lead</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;">Tienes ~5 min para contactarle.</div>
    </div>

    <div style="font-size:18px;font-weight:700;color:#0f172a;margin:6px 0 14px 0;">${escapeHtml(v.fullName)}</div>

    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Email</td><td style="padding:6px 0;color:#0f172a;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.email)}</td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">WhatsApp</td><td style="padding:6px 0;color:#0f172a;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.whatsappE164)}</td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">País / idioma</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.country)} · ${escapeHtml(v.language.toUpperCase())}</td></tr>
      ${v.motivoLabel ? `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Motivo (paso 0)</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.motivoLabel)}</td></tr>` : ""}
      ${v.germanLevel ? `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Nivel</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.germanLevel)}</td></tr>` : ""}
      ${v.goal        ? `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Objetivo</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.goal)}</td></tr>` : ""}
      ${v.urgency     ? `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Urgencia</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.urgency)}</td></tr>` : ""}
      ${v.budget      ? `<tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Presupuesto</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.budget)}</td></tr>` : ""}
      ${trialBlock}
    </table>

    <div style="text-align:center;margin:24px 0 12px 0;">
      ${button(waUrl, "💬 Escribir por WhatsApp ahora")}
    </div>

    <div style="text-align:center;margin:8px 0 18px 0;">
      <a href="${escapeHtml(v.adminProfileUrl)}" style="font-size:13px;color:#ea580c;text-decoration:none;font-weight:600;">
        Ver perfil completo en admin →
      </a>
    </div>

    ${p(`<em style="color:#64748b;font-size:12px;">Recibido ${new Date().toLocaleString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} (Berlín)</em>`)}
  `;

  const footerNote = `Recibes este aviso porque tu cuenta superadmin está suscrita a "Nuevo Lead".`;

  // Versión texto plano (fallback para clientes sin HTML)
  const text = [
    `🚨 IMPORTANTE: Nuevo Lead`,
    ``,
    `Tienes ~5 minutos para contactarle.`,
    ``,
    `Nombre:    ${v.fullName}`,
    `Email:     ${v.email}`,
    `WhatsApp:  ${v.whatsappE164}`,
    `País:      ${v.country} (${v.language.toUpperCase()})`,
    v.motivoLabel ? `Motivo:    ${v.motivoLabel}` : null,
    v.germanLevel ? `Nivel:     ${v.germanLevel}` : null,
    v.goal        ? `Objetivo:  ${v.goal}` : null,
    v.urgency     ? `Urgencia:  ${v.urgency}` : null,
    v.budget      ? `Presupuesto: ${v.budget}` : null,
    v.trialStartIso
      ? `Trial:     ${new Date(v.trialStartIso).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })}${v.trialTeacher ? " · " + v.trialTeacher : ""}`
      : `Trial:     Pendiente`,
    ``,
    `Escribir por WhatsApp:`,
    waUrl,
    ``,
    `Ver perfil en admin:`,
    v.adminProfileUrl,
    ``,
    `— Aprender-Aleman.de`,
  ].filter(Boolean).join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
