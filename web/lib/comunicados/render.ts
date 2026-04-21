import { escapeHtml, renderEnvelope } from "@/lib/email/templates/base";

/**
 * Minimal markdown → {html, text} renderer tailored for admin broadcasts.
 *
 * Scope (intentionally small — a WYSIWYG editor is out-of-scope):
 *   • Blank-line separated paragraphs
 *   • `**bold**`, `*italic*`, `` `code` ``
 *   • Unordered lists with `- ` bullets (single level)
 *   • `[label](url)` links
 *   • Horizontal rule: a line of `---`
 *   • Soft line breaks (single `\n` inside a paragraph → `<br>`)
 *
 * HTML output reuses the existing orange envelope so the look matches
 * the rest of the transactional emails. WhatsApp output is plain text
 * with the markdown tokens stripped (links rendered as "label (url)").
 */

export type Rendered = { subject: string; html: string; text: string };

export function renderBroadcast(subject: string, markdown: string, name?: string): Rendered {
  const greet = name && name.trim() ? `¡Hola ${name.trim()}! 👋\n\n` : "";
  const source = greet + markdown.trim();
  const html   = renderEnvelope(markdownToHtml(source), footerNote());
  const text   = markdownToText(source);
  return { subject, html, text };
}

export function renderWhatsappOnly(markdown: string, name?: string): string {
  const greet = name && name.trim() ? `¡Hola ${name.trim()}! 👋\n\n` : "";
  return markdownToText(greet + markdown.trim());
}

function footerNote(): string {
  return (
    "Recibes este correo como parte de la comunicación de Aprender-Aleman.de. " +
    "Si quieres responder, puedes hacerlo directamente a este email."
  );
}

// ---------------------------------------------------------------------------
// Markdown → HTML (body fragment — the envelope wraps it).
// ---------------------------------------------------------------------------
function markdownToHtml(src: string): string {
  const blocks = src
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const block of blocks) {
    if (/^-{3,}$/.test(block)) {
      parts.push(`<hr style="border:0;border-top:1px solid #fed7aa;margin:20px 0;">`);
      continue;
    }
    if (block.split("\n").every(l => /^\s*-\s+/.test(l))) {
      const items = block
        .split("\n")
        .map(l => l.replace(/^\s*-\s+/, ""))
        .map(l => `<li style="margin:4px 0;font-size:15px;color:#334155;">${inlineToHtml(l)}</li>`)
        .join("");
      parts.push(`<ul style="margin:0 0 14px 18px;padding:0;">${items}</ul>`);
      continue;
    }
    // Paragraph — soft line breaks become <br>.
    const lines = block.split("\n").map(inlineToHtml).join("<br>");
    parts.push(`<p style="margin:0 0 14px 0;font-size:15px;color:#334155;line-height:1.55;">${lines}</p>`);
  }
  return parts.join("");
}

function inlineToHtml(s: string): string {
  let out = escapeHtml(s);
  // Code spans first so * inside backticks doesn't break.
  out = out.replace(/`([^`]+)`/g, (_m, c: string) =>
    `<code style="background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">${c}</code>`);
  // Links.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${url}" style="color:#ea580c;text-decoration:none;">${label}</a>`);
  // Bold then italic (bold first so ** isn't parsed as two *).
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

// ---------------------------------------------------------------------------
// Markdown → plain text (for WhatsApp + email text/plain part).
// ---------------------------------------------------------------------------
function markdownToText(src: string): string {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/^\s*-{3,}\s*$/gm, "————————————")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .trim();
}
