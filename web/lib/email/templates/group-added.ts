import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Sent to a student when admin / teacher adds them to a class group.
 * Includes a one-shot summary of how many future classes they just
 * inherited and the very next one's date — so the inbox isn't
 * spammed with one email per inherited class.
 */
export type GroupAddedVars = {
  recipientName:    string;        // first name only
  groupName:        string;
  teacherName:      string;
  upcomingCount:    number;        // classes future-scheduled in this group
  nextClassDate?:   string;        // pre-formatted "lunes 28 de abril, 19:00 (Berlín)" — undefined if 0 upcoming
  myClassesUrl:     string;        // platform link to /estudiante/clases
  language:         "es" | "de";
};

export function renderGroupAdded(v: GroupAddedVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: GroupAddedVars): RenderedEmail {
  const subject = `✅ Te hemos añadido al grupo ${v.groupName}`;
  const opener = v.upcomingCount > 0
    ? `Te hemos añadido al grupo <strong>${escapeHtml(v.groupName)}</strong> con ${escapeHtml(v.teacherName)}. Tienes <strong>${v.upcomingCount} próxima${v.upcomingCount === 1 ? "" : "s"} clase${v.upcomingCount === 1 ? "" : "s"}</strong> agendada${v.upcomingCount === 1 ? "" : "s"} en tu calendario.`
    : `Te hemos añadido al grupo <strong>${escapeHtml(v.groupName)}</strong> con ${escapeHtml(v.teacherName)}. Aún no hay clases agendadas — recibirás un correo cuando se programe la primera.`;
  const kv: Array<[string, string]> = [
    ["👤 Profesor/a", escapeHtml(v.teacherName)],
    ["📚 Grupo",      escapeHtml(v.groupName)],
  ];
  if (v.nextClassDate) kv.push(["📅 Próxima clase", escapeHtml(v.nextClassDate)]);

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(opener)}
    ${kvBlock(kv)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.myClassesUrl, "Ver mis clases →")}
    </div>
    ${p(`Antes de cada clase te enviaremos un recordatorio.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Recibes este correo porque te hemos añadido a un grupo de clases en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.recipientName}!`, ``,
    v.upcomingCount > 0
      ? `Te añadimos al grupo ${v.groupName} con ${v.teacherName}. Tienes ${v.upcomingCount} próxima${v.upcomingCount === 1 ? "" : "s"} clase${v.upcomingCount === 1 ? "" : "s"} agendada${v.upcomingCount === 1 ? "" : "s"}.`
      : `Te añadimos al grupo ${v.groupName} con ${v.teacherName}.`,
    v.nextClassDate ? `Próxima clase: ${v.nextClassDate}` : ``,
    ``,
    `Ver mis clases: ${v.myClassesUrl}`, ``,
    `— Aprender-Aleman.de`,
  ].filter(Boolean).join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: GroupAddedVars): RenderedEmail {
  const subject = `✅ Du wurdest der Gruppe ${v.groupName} hinzugefügt`;
  const opener = v.upcomingCount > 0
    ? `Wir haben dich der Gruppe <strong>${escapeHtml(v.groupName)}</strong> mit ${escapeHtml(v.teacherName)} hinzugefügt. Du hast <strong>${v.upcomingCount} kommende Stunde${v.upcomingCount === 1 ? "" : "n"}</strong> in deinem Kalender.`
    : `Wir haben dich der Gruppe <strong>${escapeHtml(v.groupName)}</strong> mit ${escapeHtml(v.teacherName)} hinzugefügt. Es sind noch keine Stunden agendiert — du erhältst eine E-Mail, sobald die erste angesetzt wird.`;
  const kv: Array<[string, string]> = [
    ["👤 Lehrer/in",      escapeHtml(v.teacherName)],
    ["📚 Gruppe",         escapeHtml(v.groupName)],
  ];
  if (v.nextClassDate) kv.push(["📅 Nächste Stunde", escapeHtml(v.nextClassDate)]);

  const body = `
    ${h2(`Hallo ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(opener)}
    ${kvBlock(kv)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.myClassesUrl, "Meine Stunden ansehen →")}
    </div>
    ${p(`Vor jeder Stunde senden wir dir eine Erinnerung.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Du erhältst diese E-Mail, weil wir dich einer Klassengruppe auf Aprender-Aleman.de hinzugefügt haben.";
  const text = [
    `Hallo ${v.recipientName}!`, ``,
    v.upcomingCount > 0
      ? `Wir haben dich der Gruppe ${v.groupName} mit ${v.teacherName} hinzugefügt. Du hast ${v.upcomingCount} kommende Stunde${v.upcomingCount === 1 ? "" : "n"}.`
      : `Wir haben dich der Gruppe ${v.groupName} mit ${v.teacherName} hinzugefügt.`,
    v.nextClassDate ? `Nächste Stunde: ${v.nextClassDate}` : ``,
    ``,
    `Meine Stunden: ${v.myClassesUrl}`, ``,
    `— Aprender-Aleman.de`,
  ].filter(Boolean).join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
