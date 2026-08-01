import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";

/**
 * GET/POST /api/cron/email-orphan-recovery
 *
 * Cron diario que detecta emails en `send_failed` de las últimas 48h y:
 *   1. Reintenta 1 vez cada uno (sendRaw ya tiene failover Resend→SMTP
 *      + 4 attempts con backoff, así que este reintento es la 2ª ronda).
 *   2. Si vuelve a fallar, marca el timeline con `orphan_retried=true`
 *      para no reprocesarlo en el siguiente run.
 *   3. Envía digest al admin con los que quedaron huérfanos.
 *
 * Idempotencia: `metadata.orphan_retried_at` bloquea reprocessing.
 *
 * Schedule sugerido: 0 5 * * * (05:00 UTC diario, antes del morning digest).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "aprenderaleman2026@gmail.com";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

type TimelineRow = {
  id: string;
  lead_id: string;
  content: string;
  timestamp: string;
  metadata: { sent_to?: string; subject?: string; orphan_retried_at?: string; kind?: string } | null;
};

async function run(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();

  const { data: fails } = await sb
    .from("lead_timeline")
    .select("id, lead_id, content, timestamp, metadata")
    .eq("type", "send_failed")
    .filter("metadata->>channel", "eq", "email")
    .gte("timestamp", since)
    .limit(100);

  const rows = (fails ?? []) as TimelineRow[];
  const candidates = rows.filter(r => !r.metadata?.orphan_retried_at);

  let recovered = 0, stillFailed = 0;
  const stillFailedDetails: Array<{ leadId: string; to: string; subject: string; when: string; kind: string }> = [];

  for (const r of candidates) {
    const to      = r.metadata?.sent_to ?? "";
    const subject = r.metadata?.subject ?? "(sin asunto)";
    const kind    = r.metadata?.kind ?? "unknown";
    if (!to) continue;

    // No conocemos el HTML original (no lo guardamos en timeline). Enviamos
    // un email genérico de "no pudimos enviarte la comunicación anterior,
    // te dejamos el resumen y el link al panel". Es preferible a nada.
    const bodyText = `Hola,\n\nTuvimos un problema técnico al enviarte la comunicación "${subject}" hace unas horas.\n\n` +
      `Si necesitas ver el contenido o continuar, entra a tu panel:\nhttps://b2c.aprender-aleman.de\n\n` +
      `Si crees que es un error, respóndenos a este correo.\n\n— Aprender-Aleman.de`;
    const bodyHtml = `<p>Hola,</p><p>Tuvimos un problema técnico al enviarte la comunicación "<strong>${subject}</strong>" hace unas horas.</p>` +
      `<p>Si necesitas ver el contenido o continuar, entra a tu panel: <a href="https://b2c.aprender-aleman.de">b2c.aprender-aleman.de</a></p>` +
      `<p>Si crees que es un error, respóndenos a este correo.</p><p>— Aprender-Aleman.de</p>`;

    const res = await sendRaw(to, `[Reintento] ${subject}`, bodyHtml, bodyText);
    const newMeta = { ...(r.metadata ?? {}), orphan_retried_at: new Date().toISOString() };
    await sb.from("lead_timeline").update({ metadata: newMeta }).eq("id", r.id);

    if (res.ok) {
      recovered++;
      await sb.from("lead_timeline").insert({
        lead_id: r.lead_id,
        type:    "system_message_sent",
        author:  "cron:email-orphan-recovery",
        content: `📧 Reintento exitoso: ${subject} → ${to}`,
        metadata: { kind: "orphan_recovery", channel: "email", original_failure_id: r.id, sent_to: to },
      });
    } else {
      stillFailed++;
      stillFailedDetails.push({ leadId: r.lead_id, to, subject, when: r.timestamp, kind });
    }
  }

  // Digest admin — solo si hay orphans.
  if (stillFailedDetails.length > 0) {
    const listHtml = stillFailedDetails.map(d =>
      `<li><code>${d.leadId.slice(0, 8)}</code> — ${d.to} — "${d.subject}" (${d.kind}, ${new Date(d.when).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })})</li>`,
    ).join("");
    const html = `<h2>Emails huérfanos tras reintento (últimas 48h)</h2>` +
      `<p><strong>${stillFailedDetails.length}</strong> emails no se pudieron entregar tras el reintento del cron.</p>` +
      `<ul>${listHtml}</ul>` +
      `<p>Revisa /admin/mensajes para decidir siguiente paso.</p>`;
    const text = `Emails huérfanos tras reintento (últimas 48h):\n\n` +
      stillFailedDetails.map(d => `- ${d.leadId.slice(0, 8)} ${d.to} "${d.subject}" (${d.kind})`).join("\n");
    await sendRaw(ADMIN_EMAIL, `📧 ${stillFailedDetails.length} emails huérfanos hoy`, html, text);
  }

  return NextResponse.json({
    ok: true,
    scanned:      rows.length,
    candidates:   candidates.length,
    recovered,
    still_failed: stillFailed,
  });
}
