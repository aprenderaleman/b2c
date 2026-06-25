/**
 * Tiny HTML email renderer. We don't pull in react-email to avoid another
 * build step: emails are simple template strings with inline styles that
 * render reliably across Gmail / Outlook / Apple Mail.
 *
 * Every template follows the same envelope: header with our logo, the
 * body content, a simple footer with contact info + legal line.
 */

export type RenderedEmail = {
  subject: string;
  html:    string;
  text:    string;
};

/** Escape so user-provided names can't break HTML structure. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEnvelope(body: string, footerNote: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Aprender-Aleman.de</title>
  </head>
  <body style="margin:0;padding:0;background:#fff7ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.55;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7ed;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px -10px rgba(249,115,22,0.20);border:1px solid #fed7aa;">
          <tr><td style="padding:24px 28px;border-bottom:1px solid #fed7aa;background:linear-gradient(135deg,#fb923c 0%,#f97316 100%);">
            <!-- Marca: logo + wordmark. Tabla por compatibilidad con
                 clientes email viejos (Outlook web/desktop) — flexbox no
                 es fiable. La imagen se sirve desde producción para que
                 cualquier cliente la cargue sin necesidad de attachment. -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding-right:12px;vertical-align:middle;line-height:0;">
                  <img src="https://b2c.aprender-aleman.de/Logonewwithbg.png"
                       width="40" height="40" alt="Aprender-Aleman.de"
                       style="border:0;display:block;border-radius:10px;">
                </td>
                <td style="vertical-align:middle;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.02em;">
                  Aprender-Aleman.de
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:28px;">
            ${body}
          </td></tr>
          <tr><td style="padding:20px 28px;background:#fff7ed;border-top:1px solid #fed7aa;font-size:12px;color:#78716c;">
            ${footerNote}
            <br><br>
            Aprender-Aleman.de · Gelfis Horn, Einzelunternehmer · Springe (DE)<br>
            <a href="https://aprender-aleman.de" style="color:#ea580c;text-decoration:none;">aprender-aleman.de</a>
            ·
            <a href="https://aprender-aleman.de/privacy" style="color:#ea580c;text-decoration:none;">Privacidad</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:14px 24px;background:linear-gradient(135deg,#fb923c 0%,#f97316 100%);color:#ffffff;font-weight:700;text-decoration:none;border-radius:14px;font-size:15px;">${escapeHtml(label)}</a>`;
}

/**
 * Botones full-width usados en los emails de trial. Diseñados para
 * ser táctiles (44px+ height) y obvios en cualquier cliente de email.
 * Cada uno tiene un color distinto para que el lead distinga la
 * acción a primera vista: verde = confirmar, ámbar = reagendar,
 * azul = entrar al aula.
 */
export function bigButton(
  href: string,
  label: string,
  variant: "confirm" | "reschedule" | "join",
): string {
  const palette = {
    confirm:    { bg: "#16a34a", shadow: "rgba(22,163,74,0.25)" },
    reschedule: { bg: "#d97706", shadow: "rgba(217,119,6,0.25)" },
    join:       { bg: "#2563eb", shadow: "rgba(37,99,235,0.25)" },
  }[variant];
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:10px 0;">
    <tr><td align="center">
      <a href="${href}" style="display:block;padding:16px 20px;background:${palette.bg};color:#ffffff;font-weight:700;text-decoration:none;border-radius:12px;font-size:16px;text-align:center;box-shadow:0 4px 12px ${palette.shadow};">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

export function h2(text: string): string {
  return `<h1 style="font-size:22px;font-weight:800;margin:0 0 14px 0;color:#0f172a;letter-spacing:-0.01em;">${escapeHtml(text)}</h1>`;
}

export function p(text: string): string {
  return `<p style="margin:0 0 14px 0;font-size:15px;color:#334155;">${text}</p>`;
}

export function kvBlock(rows: Array<[string, string]>): string {
  const lis = rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:14px;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;">${v}</td></tr>`)
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:10px 0 20px 0;background:#fff7ed;border-radius:12px;padding:8px 14px;">${lis}</table>`;
}
