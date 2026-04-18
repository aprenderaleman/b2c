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
          <tr><td style="padding:28px 28px 16px 28px;border-bottom:1px solid #fed7aa;background:linear-gradient(135deg,#fb923c 0%,#f97316 100%);">
            <div style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.02em;">Aprender-Aleman.de</div>
            <div style="color:#ffedd5;font-size:13px;margin-top:2px;">Academia Premium Online</div>
          </td></tr>
          <tr><td style="padding:28px;">
            ${body}
          </td></tr>
          <tr><td style="padding:20px 28px;background:#fff7ed;border-top:1px solid #fed7aa;font-size:12px;color:#78716c;">
            ${footerNote}
            <br><br>
            Aprender-Aleman.de · Linguify Global LLC<br>
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
