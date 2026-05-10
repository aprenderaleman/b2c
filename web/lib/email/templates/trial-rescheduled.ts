import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * trial-rescheduled — el lead recibe este mail cuando admin/Stiv mueve
 * la fecha/hora de su clase de prueba desde /admin/leads/[id].
 *
 * Tono: breve, sin disculpas innecesarias, link directo al aula y
 * petición clara de confirmar asistencia. Distinto de
 * `class-lifecycle` (que es para alumnos/profes con cuenta).
 */
export type TrialRescheduledVars = {
  leadName:    string;       // first name
  newStartDate: string;      // "viernes 9 de mayo, 17:00 (Berlín)"
  durationMin: number;
  joinUrl:     string;       // magic-link al aula
  language:    "es" | "de";
};

export function renderTrialRescheduled(v: TrialRescheduledVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialRescheduledVars): RenderedEmail {
  const subject = `Tu clase de prueba se ha reagendado · ${v.newStartDate}`;
  const body = [
    h2(`${escapeHtml(v.leadName)}, hemos reagendado tu clase`),
    p(`Tu clase de prueba GRATIS de alemán ha sido movida a una nueva fecha:`),
    kvBlock([
      ["📅 Nueva fecha", escapeHtml(v.newStartDate)],
      ["⏱ Duración",    `${v.durationMin} minutos`],
    ]),
    p(`Entra al aula desde el siguiente enlace cuando llegue la hora:`),
    button("Entrar a la clase", v.joinUrl),
    p(
      `Por favor confírmanos que asistirás respondiendo "Sí" por WhatsApp 🙌`,
    ),
  ].join("\n");
  const html = renderEnvelope(body, "Aprender-Aleman.de · Clase de prueba reagendada.");
  const text = [
    `${v.leadName}, hemos reagendado tu clase de prueba GRATIS de alemán.`,
    ``,
    `Nueva fecha: ${v.newStartDate}`,
    `Duración: ${v.durationMin} min`,
    ``,
    `Aula: ${v.joinUrl}`,
    ``,
    `Por favor confírmanos que asistirás respondiendo "Sí" por WhatsApp.`,
    ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html, text };
}

function renderDE(v: TrialRescheduledVars): RenderedEmail {
  const subject = `Deine Probestunde wurde verschoben · ${v.newStartDate}`;
  const body = [
    h2(`${escapeHtml(v.leadName)}, deine Probestunde wurde verschoben`),
    p(`Deine kostenlose Probestunde Deutsch hat einen neuen Termin:`),
    kvBlock([
      ["📅 Neuer Termin", escapeHtml(v.newStartDate)],
      ["⏱ Dauer",         `${v.durationMin} Minuten`],
    ]),
    p(`Du betrittst den Unterrichtsraum hier, sobald es soweit ist:`),
    button("Zum Unterrichtsraum", v.joinUrl),
    p(`Bitte bestätige mit einem "Ja" per WhatsApp, dass du dabei bist 🙌`),
  ].join("\n");
  const html = renderEnvelope(body, "Aprender-Aleman.de · Probestunde verschoben.");
  const text = [
    `${v.leadName}, deine Probestunde Deutsch wurde verschoben.`,
    ``,
    `Neuer Termin: ${v.newStartDate}`,
    `Dauer: ${v.durationMin} Min`,
    ``,
    `Unterrichtsraum: ${v.joinUrl}`,
    ``,
    `Bitte bestätige mit einem "Ja" per WhatsApp, dass du dabei bist.`,
    ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html, text };
}
