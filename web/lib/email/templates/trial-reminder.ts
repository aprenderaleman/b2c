import { bigButton, button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

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
  tone:        "24h_before" | "morning_of" | "imminent_15m";
  recipientName: string;            // first name only ("Hans" or "Sabine")
  counterpartName: string;          // for the lead → teacher; for the teacher → lead
  startDate:   string;              // pre-formatted "viernes 26 de abril, 17:00 (Berlín)"
  durationMin: number;
  joinUrl:     string;              // magic-link for lead, /aula/<id> for teacher
  language:    "es" | "de";
  /** URLs de los botones del email — solo para audience=lead, tone=24h_before|morning_of. */
  confirmUrl?:    string;
  rescheduleUrl?: string;
};

export function renderTrialReminder(v: TrialReminderVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function leadSubjectES(tone: TrialReminderVars["tone"], when: string): string {
  if (tone === "imminent_15m") return `⏰ En 15 min empieza tu clase de alemán`;
  return tone === "24h_before"
    ? `🔔 Mañana es tu clase de prueba de alemán — ${when}`
    : `🔔 Hoy es tu clase de prueba de alemán — ${when}`;
}
function leadSubjectDE(tone: TrialReminderVars["tone"], when: string): string {
  if (tone === "imminent_15m") return `⏰ In 15 Min beginnt deine Deutsch-Stunde`;
  return tone === "24h_before"
    ? `🔔 Morgen ist deine Deutsch-Probestunde — ${when}`
    : `🔔 Heute ist deine Deutsch-Probestunde — ${when}`;
}
function teacherSubjectES(tone: TrialReminderVars["tone"], lead: string): string {
  if (tone === "imminent_15m") return `⏰ En 15 min: clase con ${lead}`;
  return tone === "24h_before"
    ? `📚 Mañana: clase de prueba de alemán con ${lead}`
    : `📚 Hoy: clase de prueba de alemán con ${lead}`;
}
function teacherSubjectDE(tone: TrialReminderVars["tone"], lead: string): string {
  if (tone === "imminent_15m") return `⏰ In 15 Min: Probestunde mit ${lead}`;
  return tone === "24h_before"
    ? `📚 Morgen: Deutsch-Probestunde mit ${lead}`
    : `📚 Heute: Deutsch-Probestunde mit ${lead}`;
}

function renderES(v: TrialReminderVars): RenderedEmail {
  const isLead = v.audience === "lead";
  const subject = isLead
    ? leadSubjectES(v.tone, v.startDate)
    : teacherSubjectES(v.tone, v.counterpartName);

  // Profesores: layout original — info operativa, 1 botón al aula.
  // Policy Gelfis 2026-04-30: NO mencionar nombre del profesor al lead.
  if (!isLead) {
    const opener = v.tone === "imminent_15m"
      ? `⏰ <strong>En 15 minutos</strong> tienes la clase con ${escapeHtml(v.counterpartName)}.`
      : v.tone === "24h_before"
        ? `Recordatorio: <strong>mañana</strong> tienes una clase de prueba de alemán con ${escapeHtml(v.counterpartName)}.`
        : `Recordatorio: <strong>hoy</strong> tienes una clase de prueba de alemán con ${escapeHtml(v.counterpartName)}.`;
    const body = `
      ${h2(`¡Hola ${escapeHtml(v.recipientName)}! 👋`)}
      ${p(opener)}
      ${kvBlock([
        ["📅 Fecha",   escapeHtml(v.startDate)],
        ["⏱ Duración", `${v.durationMin} minutos`],
        ["👤 Lead",    escapeHtml(v.counterpartName)],
      ])}
      <div style="text-align:center;margin:24px 0 8px 0;">
        ${button(v.joinUrl, "Entrar al aula →")}
      </div>
      ${p(`<em style="color:#64748b;">El aula abre 15 min antes. Si necesitas reagendar, escribe a Gelfis.</em>`)}
      ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
    `;
    const text = [
      `¡Hola ${v.recipientName}!`, ``,
      v.tone === "imminent_15m" ? `⏰ En 15 min: clase con ${v.counterpartName}.` : `Recordatorio: clase de prueba con ${v.counterpartName}.`,
      `Fecha: ${v.startDate}`, `Duración: ${v.durationMin} min`, ``,
      `Entrar al aula: ${v.joinUrl}`, ``,
      `— Aprender-Aleman.de`,
    ].join("\n");
    return { subject, html: renderEnvelope(body, "Recibes este correo porque eres el profesor/a asignado/a a esta clase de prueba."), text };
  }

  // Lead — layout por tono. Botones CONFIRMAR/CAMBIAR solo en 24h_before
  // y morning_of (en 15m no tiene sentido — ya empezó la clase).
  const showActionButtons = (v.tone === "24h_before" || v.tone === "morning_of") && !!v.confirmUrl && !!v.rescheduleUrl;

  let body: string;
  if (v.tone === "imminent_15m") {
    body = `
      ${h2(`${escapeHtml(v.recipientName)}, en 15 minutos empieza tu clase ⏰`)}
      ${p(`Tu clase de alemán comienza en muy poco. Entra ya:`)}
      ${bigButton(v.joinUrl, "Entrar al aula →", "join")}
      ${p(`<em style="color:#64748b;font-size:13px;">No necesitas instalar nada — el aula abre en el navegador.</em>`)}
      ${p(`¡Te veo en un rato!<br><em style="color:#64748b;">— Stiv</em>`)}
    `;
  } else if (v.tone === "morning_of") {
    body = `
      ${h2(`¡Buenos días ${escapeHtml(v.recipientName)}! Hoy es el día 🎉`)}
      ${p(`Tu <strong>clase de prueba de alemán</strong> es HOY:`)}
      ${kvBlock([
        ["📅 Cuándo",   escapeHtml(v.startDate)],
        ["⏱ Duración", `${v.durationMin} minutos`],
      ])}
      ${bigButton(v.joinUrl, "Entrar al aula →", "join")}
      ${p(`<em style="color:#64748b;font-size:13px;">Abre el enlace 5 min antes. No instala nada — abre en el navegador.</em>`)}
      ${showActionButtons ? `
        <hr style="border:0;border-top:1px solid #fed7aa;margin:24px 0;">
        ${p(`Si por algún imprevisto <strong>no puedes asistir hoy</strong>, avísame con un clic:`)}
        ${bigButton(v.rescheduleUrl!, "📅 CAMBIAR DE FECHA", "reschedule")}
      ` : ""}
      ${p(`Wir sehen uns endlich heute 😊<br><em style="color:#64748b;">— Stiv</em>`)}
    `;
  } else {
    // 24h_before
    body = `
      ${h2(`¡Hola ${escapeHtml(v.recipientName)}! 👋`)}
      ${p(`Te recuerdo que <strong>mañana</strong> es tu clase de prueba de alemán:`)}
      ${kvBlock([
        ["📅 Cuándo",   escapeHtml(v.startDate)],
        ["⏱ Duración", `${v.durationMin} minutos`],
      ])}
      ${showActionButtons ? `
        ${p(`<strong>¿Sigues pudiendo asistir?</strong> Un clic me lo confirma:`)}
        ${bigButton(v.confirmUrl!, "✅ SÍ, CONFIRMADO", "confirm")}
        ${bigButton(v.rescheduleUrl!, "📅 NECESITO CAMBIAR FECHA", "reschedule")}
        <hr style="border:0;border-top:1px solid #fed7aa;margin:24px 0;">
      ` : ""}
      ${p(`🔗 <strong>Tu enlace al aula:</strong>`)}
      <div style="text-align:center;margin:14px 0;">${button(v.joinUrl, "Entrar al aula →")}</div>
      ${p(`<em style="color:#64748b;font-size:13px;">Te recordaré también mañana por la mañana y poco antes de la clase. ¡Nos vemos pronto!</em>`)}
      ${p(`<em style="color:#64748b;">— Stiv</em>`)}
    `;
  }

  const text = [
    `¡Hola ${v.recipientName}!`, ``,
    v.tone === "imminent_15m" ? `⏰ En 15 minutos empieza tu clase de prueba de alemán.`
      : v.tone === "24h_before" ? `Mañana es tu clase de prueba de alemán.`
      : `Hoy es tu clase de prueba de alemán.`,
    `Fecha: ${v.startDate}`,
    `Duración: ${v.durationMin} min`, ``,
    `Entrar al aula: ${v.joinUrl}`, ``,
    ...(showActionButtons && v.confirmUrl ? [`✅ Confirmar: ${v.confirmUrl}`] : []),
    ...(showActionButtons && v.rescheduleUrl ? [`📅 Cambiar fecha: ${v.rescheduleUrl}`, ``] : []),
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, "Recibes este correo porque tienes una clase de prueba agendada con nosotros."), text };
}

function renderDE(v: TrialReminderVars): RenderedEmail {
  const isLead = v.audience === "lead";
  const subject = isLead
    ? leadSubjectDE(v.tone, v.startDate)
    : teacherSubjectDE(v.tone, v.counterpartName);

  // Policy Gelfis 2026-04-30: no mencionar nombre del profesor al lead.
  const opener = isLead
    ? (v.tone === "imminent_15m"
        ? `⏰ <strong>In 15 Minuten</strong> beginnt deine Deutsch-Probestunde. Tritt über den Button unten ein.`
        : v.tone === "24h_before"
          ? `<strong>Morgen</strong> hast du deine Deutsch-Probestunde. Hier sind die Details.`
          : `<strong>Heute ist es so weit</strong> — deine Deutsch-Probestunde. Alle Infos findest du unten.`)
    : (v.tone === "imminent_15m"
        ? `⏰ <strong>In 15 Minuten</strong> hast du die Stunde mit ${escapeHtml(v.counterpartName)}.`
        : v.tone === "24h_before"
          ? `Erinnerung: <strong>morgen</strong> hast du eine Probestunde mit ${escapeHtml(v.counterpartName)}.`
          : `Erinnerung: <strong>heute</strong> hast du eine Probestunde mit ${escapeHtml(v.counterpartName)}.`);

  const kvRowsDE: Array<[string, string]> = [
    ["📅 Datum",     escapeHtml(v.startDate)],
    ["⏱ Dauer",      `${v.durationMin} Minuten`],
  ];
  if (!isLead) {
    kvRowsDE.push(["👤 Lead", escapeHtml(v.counterpartName)]);
  }

  const body = `
    ${h2(`Hallo ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(opener)}
    ${kvBlock(kvRowsDE)}
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
      ? (v.tone === "imminent_15m" ? `⏰ In 15 Minuten beginnt deine Deutsch-Probestunde.`
         : v.tone === "24h_before" ? `Morgen ist deine Deutsch-Probestunde.`
         : `Heute ist deine Deutsch-Probestunde.`)
      : (v.tone === "imminent_15m" ? `⏰ In 15 Min: Probestunde mit ${v.counterpartName}.`
         : `Erinnerung: Probestunde mit ${v.counterpartName}.`),
    `Datum: ${v.startDate}`,
    `Dauer: ${v.durationMin} Min`, ``,
    `Zum Klassenzimmer: ${v.joinUrl}`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
