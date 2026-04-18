import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

export type PasswordResetVars = {
  name: string | null;
  resetUrl: string;       // full URL including the token
  expiresInHours: number; // human-readable hint, e.g. 1
  language: "es" | "de";
};

export function renderPasswordReset(v: PasswordResetVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: PasswordResetVars): RenderedEmail {
  const subject = "Restablecer tu contraseña — Aprender-Aleman.de";
  const greeting = v.name ? `¡Hola ${escapeHtml(v.name)}!` : "¡Hola!";

  const body = `
    ${h2(greeting)}
    ${p("Has solicitado restablecer tu contraseña. Pulsa el botón de abajo para elegir una nueva.")}
    <div style="text-align:center;margin:22px 0 24px 0;">
      ${button(v.resetUrl, "Restablecer contraseña →")}
    </div>
    ${p(`El enlace expira en ${v.expiresInHours} hora${v.expiresInHours === 1 ? "" : "s"}. Si no fuiste tú, ignora este correo — tu contraseña actual seguirá siendo válida.`)}
    ${p(`<em style="color:#64748b;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="word-break:break-all;">${escapeHtml(v.resetUrl)}</span></em>`)}
  `;
  const footerNote = "Recibes este correo porque se ha solicitado un restablecimiento de contraseña para tu cuenta.";
  const html = renderEnvelope(body, footerNote);

  const text = [
    greeting.replace(/<[^>]+>/g, ""),
    ``,
    `Has solicitado restablecer tu contraseña. Abre este enlace para elegir una nueva:`,
    v.resetUrl,
    ``,
    `El enlace expira en ${v.expiresInHours} hora${v.expiresInHours === 1 ? "" : "s"}.`,
    `Si no fuiste tú, ignora este correo.`,
  ].join("\n");

  return { subject, html, text };
}

function renderDE(v: PasswordResetVars): RenderedEmail {
  const subject = "Passwort zurücksetzen — Aprender-Aleman.de";
  const greeting = v.name ? `Hallo ${escapeHtml(v.name)}!` : "Hallo!";

  const body = `
    ${h2(greeting)}
    ${p("Du hast das Zurücksetzen deines Passworts angefordert. Klicke auf den Button, um ein neues zu wählen.")}
    <div style="text-align:center;margin:22px 0 24px 0;">
      ${button(v.resetUrl, "Passwort zurücksetzen →")}
    </div>
    ${p(`Der Link läuft in ${v.expiresInHours} Stunde${v.expiresInHours === 1 ? "" : "n"} ab. Wenn du das nicht warst, kannst du diese E-Mail ignorieren — dein bisheriges Passwort bleibt gültig.`)}
    ${p(`<em style="color:#64748b;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br><span style="word-break:break-all;">${escapeHtml(v.resetUrl)}</span></em>`)}
  `;
  const footerNote = "Du erhältst diese E-Mail, weil für dein Konto das Zurücksetzen des Passworts angefordert wurde.";
  const html = renderEnvelope(body, footerNote);

  const text = [
    greeting.replace(/<[^>]+>/g, ""),
    ``,
    `Du hast das Zurücksetzen deines Passworts angefordert. Öffne diesen Link:`,
    v.resetUrl,
    ``,
    `Der Link läuft in ${v.expiresInHours} Stunde${v.expiresInHours === 1 ? "" : "n"} ab.`,
    `Wenn du das nicht warst, ignoriere diese E-Mail.`,
  ].join("\n");

  return { subject, html, text };
}
