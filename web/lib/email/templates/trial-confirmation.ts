import { bigButton, button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";
import type { LeadJoinUrl } from "@/lib/trial-token";

/**
 * Email enviado al lead en el instante en que agenda su clase de
 * prueba. Sustituye al bloque "responde por WhatsApp con CONFIRMO"
 * por dos botones de un clic (CONFIRMAR / CAMBIAR) — la migración
 * de WhatsApp a Meta Cloud API está en curso, así que el camino
 * principal de confirmación ahora es el email.
 */
export type TrialConfirmationVars = {
  leadName:        string;
  classTitle:      string;
  startDate:       string;
  durationMin:     number;
  teacherName:     string;
  joinUrl:         LeadJoinUrl;
  confirmUrl:      string;
  rescheduleUrl:   string;
  language:        "es" | "de";
  /** Depósito Stripe (2026-06-30). Si depositPaid=true, se muestra
   *  bloque "plaza asegurada"; si false + depositUrl presente, se
   *  incluye CTA "asegura tu plaza como prioritaria". */
  depositPaid?:    boolean;
  depositUrl?:     string | null;
};

export function renderTrialConfirmation(v: TrialConfirmationVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialConfirmationVars): RenderedEmail {
  const subject = `${v.leadName}, tu clase de prueba está agendada — ${v.startDate}`;
  const depositBlock = v.depositPaid
    ? `<div style="margin:22px 0;padding:16px;background:#d1fae5;border:2px solid #10b981;border-radius:14px;">
         <p style="margin:0;font-weight:700;color:#065f46;">🔒 Plaza asegurada</p>
         <p style="margin:6px 0 0 0;font-size:14px;color:#065f46;">Gracias por el depósito. Te devolveremos tus <strong>10€</strong> cuando asistas a la clase de prueba. Tu profesor/a tiene tu reserva marcada como prioritaria.</p>
       </div>`
    : (v.depositUrl
        ? `<div style="margin:22px 0;padding:16px;background:#fef3c7;border:1px solid #fbbf24;border-radius:14px;">
             <p style="margin:0;font-weight:700;color:#92400e;">💡 Asegura tu plaza como prioritaria</p>
             <p style="margin:6px 0 12px 0;font-size:14px;color:#92400e;">Con 10€ tu profesor/a prioriza tu reserva. <strong>Te devolvemos los 10€</strong> cuando asistas a la clase de prueba.</p>
             <div style="text-align:center;"><a href="${v.depositUrl}" style="display:inline-block;padding:10px 18px;background:#d97706;color:#fff;font-weight:600;border-radius:10px;text-decoration:none;font-size:14px;">Asegurar mi plaza — 10€ →</a></div>
           </div>`
        : "");
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! Soy Stiv de Aprender-Aleman.de 👋`)}
    ${p(`Tu <strong>clase de prueba de alemán</strong> está agendada para:`)}
    ${kvBlock([
      ["📅 Fecha",   escapeHtml(v.startDate)],
      ["⏱ Duración", `${v.durationMin} minutos`],
    ])}
    ${depositBlock}
    ${p(`<strong>¿Me confirmas que asistirás?</strong> Un solo clic basta:`)}
    ${bigButton(v.confirmUrl, "✅ CONFIRMAR ASISTENCIA", "confirm")}
    ${bigButton(v.rescheduleUrl, "📅 CAMBIAR DE FECHA", "reschedule")}
    ${p(`<em style="color:#64748b;font-size:13px;">Sin contraseña, sin liarte. Tu profesor verá enseguida que vas a venir.</em>`)}
    <hr style="border:0;border-top:1px solid #fed7aa;margin:24px 0;">
    ${p(`🔗 <strong>Aquí entras a la clase el día acordado:</strong>`)}
    <div style="text-align:center;margin:14px 0;">${button(v.joinUrl, "Entrar al aula →")}</div>
    ${p(`<em style="color:#64748b;font-size:13px;">Este enlace es exclusivo para ti — guárdalo, lo usarás el día de la clase para entrar directo sin contraseña.</em>`)}
    ${h2(`Cómo prepararte`)}
    ${p(`No necesitas estudiar nada — la clase es 100% conversacional y tu profesor se adapta a tu nivel. Solo asegúrate de tener:`)}
    ${p(`• Buena conexión a internet<br>• Cámara y micrófono funcionando<br>• Un sitio tranquilo durante ${v.durationMin} min`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque acabas de agendar una clase de prueba en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}! Soy Stiv de Aprender-Aleman.de.`, ``,
    `Tu clase de prueba de alemán está agendada para:`,
    `📅 ${v.startDate}`,
    `⏱ ${v.durationMin} min`, ``,
    `Confírmame con un clic:`,
    `✅ Confirmar:  ${v.confirmUrl}`,
    `📅 Cambiar fecha:  ${v.rescheduleUrl}`, ``,
    `Entrar al aula el día de la clase:`,
    `🔗 ${v.joinUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TrialConfirmationVars): RenderedEmail {
  // DE simplificado — sin botones aún (DSGVO copy en revisión). El
  // copy se mantiene como estaba pre-migración para no romper envíos
  // mientras se redacta la versión alemana definitiva.
  const subject = `${v.leadName}, deine Probestunde ist gebucht — ${v.startDate}`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! Ich bin Stiv von der Akademie Aprender-Aleman.de 👋`)}
    ${p(`Deine <strong>Deutsch-Probestunde</strong> ist gebucht für:`)}
    ${kvBlock([
      ["📅 Datum",  escapeHtml(v.startDate)],
      ["⏱ Dauer",   `${v.durationMin} Minuten`],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Zum Klassenzimmer am Tag der Stunde →")}
    </div>
    ${p(`<em style="color:#64748b;">Dieser Link ist nur für dich. Speichere ihn — du brauchst ihn am Tag der Stunde, um ohne Passwort einzutreten.</em>`)}
    ${h2(`Wie du dich vorbereitest`)}
    ${p(`Du musst nichts lernen — die Stunde ist konversationsbasiert und deine Lehrer/in passt sich deinem Niveau an. Stell nur Folgendes sicher:`)}
    ${p(`• Stabile Internetverbindung<br>• Funktionierende Kamera und Mikrofon<br>• Ein ruhiger Ort für ${v.durationMin} Minuten`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du gerade eine Probestunde auf Aprender-Aleman.de gebucht hast.";
  const text = [
    `Hallo ${v.leadName}! Ich bin Stiv von der Akademie Aprender-Aleman.de.`, ``,
    `Deine Deutsch-Probestunde ist gebucht für:`,
    `📅 ${v.startDate}`,
    `⏱ ${v.durationMin} Min`, ``,
    `Zum Klassenzimmer am Tag der Stunde:`,
    `🔗 ${v.joinUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
