import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Pre-class reminder used by both the 24h-before and 8 AM same-day
 * Vercel cron jobs. Same shell, different subject + leading sentence.
 *
 * Sent to BOTH the lead and the teacher (subject + greeting differ via
 * `audience`). The teacher version omits the magic-link button (they
 * have their own staff URL and don't need the lead's signed token).
 */
export type TrialReminderVars = {
  audience:    "lead" | "teacher";
  tone:        "24h_before" | "morning_of";
  recipientName: string;            // first name only ("Hans" or "Sabine")
  counterpartName: string;          // for the lead → teacher; for the teacher → lead
  startDate:   string;              // pre-formatted "viernes 26 de abril, 17:00 (Berlín)"
  durationMin: number;
  joinUrl:     string;              // magic-link for lead, /aula/<id> for teacher
  language:    "es" | "de";
};

export function renderTrialReminder(v: TrialReminderVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function leadSubjectES(tone: TrialReminderVars["tone"], when: string): string {
  return tone === "24h_before"
    ? `🔔 Mañana es tu clase de prueba — ${when}`
    : `🔔 Hoy es tu clase de prueba — ${when}`;
}
function leadSubjectDE(tone: TrialReminderVars["tone"], when: string): string {
  return tone === "24h_before"
    ? `🔔 Morgen ist deine Probestunde — ${when}`
    : `🔔 Heute ist deine Probestunde — ${when}`;
}
function teacherSubjectES(tone: TrialReminderVars["tone"], lead: string): string {
  return tone === "24h_before"
    ? `📚 Mañana: clase de prueba con ${lead}`
    : `📚 Hoy: clase de prueba con ${lead}`;
}
function teacherSubjectDE(tone: TrialReminderVars["tone"], lead: string): string {
  return tone === "24h_before"
    ? `📚 Morgen: Probestunde mit ${lead}`
    : `📚 Heute: Probestunde mit ${lead}`;
}

function renderES(v: TrialReminderVars): RenderedEmail {
  const isLead = v.audience === "lead";
  const subject = isLead
    ? leadSubjectES(v.tone, v.startDate)
    : teacherSubjectES(v.tone, v.counterpartName);

  const opener = isLead
    ? (v.tone === "24h_before"
        ? `Mañana tienes tu <strong>clase de prueba</strong> con ${escapeHtml(v.counterpartName)}. Aquí van los detalles para que la tengas a mano.`
        : `Hoy es el día — tu <strong>clase de prueba</strong> con ${escapeHtml(v.counterpartName)}. Te dejamos los detalles para que entres directo.`)
    : (v.tone === "24h_before"
        ? `Recordatorio: <strong>mañana</strong> tienes una clase de prueba con ${escapeHtml(v.counterpartName)}. Toda la info abajo.`
        : `Recordatorio: <strong>hoy</strong> tienes una clase de prueba con ${escapeHtml(v.counterpartName)}. Toda la info abajo.`);

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(opener)}
    ${kvBlock([
      ["📅 Fecha",     escapeHtml(v.startDate)],
      ["⏱ Duración",   `${v.durationMin} minutos`],
      [isLead ? "👤 Profesor/a" : "👤 Lead", escapeHtml(v.counterpartName)],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Entrar al aula →")}
    </div>
    ${isLead
      ? p(`<em style="color:#64748b;">Este enlace es exclusivo para ti — no necesitas contraseña. El aula abre 15 min antes.</em>`)
      : p(`<em style="color:#64748b;">El aula abre 15 min antes. Si necesitas reagendar, escribe a Gelfis.</em>`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;

  const footerNote = isLead
    ? "Recibes este correo porque tienes una clase de prueba agendada con nosotros."
    : "Recibes este correo porque eres el profesor/a asignado/a a esta clase de prueba.";

  const text = [
    `¡Hola ${v.recipientName}!`, ``,
    isLead
      ? `Recordatorio de tu clase de prueba con ${v.counterpartName}.`
      : `Recordatorio: clase de prueba con ${v.counterpartName}.`,
    `Fecha: ${v.startDate}`,
    `Duración: ${v.durationMin} min`, ``,
    `Entrar al aula: ${v.joinUrl}`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TrialReminderVars): RenderedEmail {
  const isLead = v.audience === "lead";
  const subject = isLead
    ? leadSubjectDE(v.tone, v.startDate)
    : teacherSubjectDE(v.tone, v.counterpartName);

  const opener = isLead
    ? (v.tone === "24h_before"
        ? `Morgen hast du deine <strong>Probestunde</strong> mit ${escapeHtml(v.counterpartName)}. Hier sind die Details.`
        : `Heute ist es so weit — deine <strong>Probestunde</strong> mit ${escapeHtml(v.counterpartName)}. Alle Infos findest du unten.`)
    : (v.tone === "24h_before"
        ? `Erinnerung: <strong>morgen</strong> hast du eine Probestunde mit ${escapeHtml(v.counterpartName)}.`
        : `Erinnerung: <strong>heute</strong> hast du eine Probestunde mit ${escapeHtml(v.counterpartName)}.`);

  const body = `
    ${h2(`Hallo ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(opener)}
    ${kvBlock([
      ["📅 Datum",     escapeHtml(v.startDate)],
      ["⏱ Dauer",      `${v.durationMin} Minuten`],
      [isLead ? "👤 Lehrer/in" : "👤 Lead", escapeHtml(v.counterpartName)],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Zum Klassenzimmer →")}
    </div>
    ${isLead
      ? p(`<em style="color:#64748b;">Dieser Link ist nur für dich — kein Passwort nötig. Das Klassenzimmer öffnet 15 Min vorher.</em>`)
      : p(`<em style="color:#64748b;">Klassenzimmer öffnet 15 Min vorher. Bei Verschiebung Gelfis kontaktieren.</em>`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;

  const footerNote = isLead
    ? "Du erhältst diese E-Mail, weil du eine Probestunde bei uns gebucht hast."
    : "Du erhältst diese E-Mail, weil du der/die zugewiesene Lehrer/in für diese Probestunde bist.";

  const text = [
    `Hallo ${v.recipientName}!`, ``,
    isLead
      ? `Erinnerung an deine Probestunde mit ${v.counterpartName}.`
      : `Erinnerung: Probestunde mit ${v.counterpartName}.`,
    `Datum: ${v.startDate}`,
    `Dauer: ${v.durationMin} Min`, ``,
    `Zum Klassenzimmer: ${v.joinUrl}`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
