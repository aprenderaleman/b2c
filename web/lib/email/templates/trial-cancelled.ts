import { bigButton, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email enviado cuando profesor / admin / superadmin cancela una clase
 * de prueba desde el panel. Reemplaza al comportamiento previo (sin
 * mensaje al lead) — Gelfis 2026-07-03: notificar al lead + darle CTA
 * para reagendar en un clic.
 */
export type TrialCancelledVars = {
  leadName:      string;
  language:      "es" | "de";
  rescheduleUrl: string;
};

export function renderTrialCancelled(v: TrialCancelledVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialCancelledVars): RenderedEmail {
  const subject = `Tu clase de prueba ha sido cancelada, ${v.leadName}`;
  const body = `
    ${h2(`¡Hola, ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Tu <strong>clase de alemán de prueba</strong> ha sido cancelada.`)}
    ${p(`Si mantienes el interés en aprender alemán, puedes agendar una nueva aquí en solo 3 minutos:`)}
    ${bigButton(v.rescheduleUrl, "📅 AGENDAR NUEVA CLASE", "reschedule")}
    ${p(`Avísame cuando lo hayas hecho. 😊`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `¡Hola, ${v.leadName}! 👋`, ``,
    `Tu clase de alemán de prueba ha sido cancelada.`, ``,
    `Si mantienes el interés en aprender alemán, puedes agendar una nueva aquí en solo 3 minutos:`,
    `👉 ${v.rescheduleUrl}`, ``,
    `Avísame cuando lo hayas hecho. 😊`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Recibes este correo porque tenías una clase de prueba agendada con nosotros."),
    text,
  };
}

function renderDE(v: TrialCancelledVars): RenderedEmail {
  // DE simplificado — mismo patrón que trial-confirmation.ts (DE se
  // mantiene en la versión anterior hasta redactar copy definitivo).
  const subject = `Deine Probestunde wurde storniert, ${v.leadName}`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Deine <strong>Deutsch-Probestunde</strong> wurde storniert.`)}
    ${p(`Wenn du weiterhin Deutsch lernen möchtest, kannst du hier in 3 Minuten eine neue Stunde buchen:`)}
    ${bigButton(v.rescheduleUrl, "📅 NEUE STUNDE BUCHEN", "reschedule")}
    ${p(`Sag mir Bescheid, sobald du fertig bist. 😊`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `Hallo ${v.leadName}! 👋`, ``,
    `Deine Deutsch-Probestunde wurde storniert.`, ``,
    `Wenn du weiterhin Deutsch lernen möchtest, kannst du hier eine neue buchen:`,
    `👉 ${v.rescheduleUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Du erhältst diese E-Mail, weil du eine Probestunde bei uns gebucht hattest."),
    text,
  };
}
