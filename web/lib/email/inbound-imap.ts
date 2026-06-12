/**
 * IMAP polling de respuestas a emails que mandamos a leads.
 *
 * Por qué IMAP en vez de webhook:
 *   - Resend (SEND) no notifica replies — solo deliveries/opens/clicks.
 *   - SMTP Hostinger (SEND) no tiene API de receive.
 *   - Las respuestas de leads llegan al buzón normal del dominio
 *     (info@aprender-aleman.de). IMAP es el unico camino universal.
 *
 * El cron /api/cron/email-inbound-poll corre cada 5 min:
 *   1. Login IMAP con IMAP_HOST / IMAP_USER / IMAP_PASS
 *   2. Busca mensajes UNSEEN desde el ultimo poll (config.last_email_inbound_poll_at)
 *   3. Por cada mensaje: extrae remitente -> match con leads.email
 *   4. Si matchea: insert lead_message_received con metadata.channel=email
 *      y el texto plano del mensaje
 *   5. Marca el mensaje como leido (\\Seen) para no re-procesar
 *   6. Actualiza last_email_inbound_poll_at
 *
 * Env vars requeridas:
 *   IMAP_HOST  ej. imap.hostinger.com
 *   IMAP_PORT  default 993
 *   IMAP_USER  info@aprender-aleman.de (o el buzon que recibe replies)
 *   IMAP_PASS  contrasena del buzon (no la de la cuenta, la del email)
 *   IMAP_TLS   default true
 *
 * Esto NO detecta replies enviadas a otra direccion (ej. si el Reply-To
 * del email outbound es distinto al From). Los emails desde nuestras
 * plantillas tienen Reply-To = From por defecto, asi que todos vuelven
 * al mismo buzon.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { supabaseAdmin } from "../supabase";

export type PollResult = {
  scanned:   number;   // mensajes leidos del buzon
  matched:   number;   // remitentes que matchearon un lead
  inserted:  number;   // inbound nuevos creados (puede ser < matched si ya existia)
  unknown:   number;   // remitentes sin lead asociado
  errors:    string[];
};

export function imapConfigured(): boolean {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS);
}

export async function pollEmailInbound(): Promise<PollResult> {
  const result: PollResult = { scanned: 0, matched: 0, inserted: 0, unknown: 0, errors: [] };

  if (!imapConfigured()) {
    result.errors.push("IMAP_HOST/IMAP_USER/IMAP_PASS no estan configurados");
    return result;
  }

  const sb = supabaseAdmin();

  // Sacamos el cursor: la fecha del ultimo poll (o T-48h si nunca corrio).
  const { data: cursorRow } = await sb
    .from("system_config")
    .select("value")
    .eq("key", "last_email_inbound_poll_at")
    .maybeSingle();
  const cursorRaw = (cursorRow as { value?: string } | null)?.value;
  const since = cursorRaw ? new Date(cursorRaw) : new Date(Date.now() - 48 * 3600 * 1000);

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: process.env.IMAP_TLS !== "false",
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASS!,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // SEARCH desde la fecha del ultimo poll. UID search devuelve los
      // uids ordenados; iteramos en lotes para no traer todo en memoria.
      const searchRes = await client.search({ since });
      // imapflow.search returns number[] | false (false = no matches).
      const uids: number[] = Array.isArray(searchRes) ? searchRes : [];
      result.scanned = uids.length;
      if (uids.length === 0) return result;

      // Cargamos todos los leads con email para hacer match rapido en JS.
      // (Volumen tipico: <5k leads, ~200kB. Mas barato que N queries.)
      const { data: leadsData } = await sb
        .from("leads")
        .select("id, email")
        .not("email", "is", null);
      const leadsByEmail = new Map<string, string>();
      for (const r of (leadsData ?? []) as Array<{ id: string; email: string }>) {
        leadsByEmail.set(r.email.trim().toLowerCase(), r.id);
      }

      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(String(uid), { source: true, envelope: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const from = (parsed.from?.value?.[0]?.address ?? "").trim().toLowerCase();
          if (!from) continue;

          const leadId = leadsByEmail.get(from);
          if (!leadId) { result.unknown++; continue; }
          result.matched++;

          const body = (parsed.text ?? parsed.subject ?? "").slice(0, 2000);
          const date = parsed.date ?? new Date();

          // Idempotencia: no insertamos si ya existe un inbound del
          // mismo lead con un body parecido en los ultimos 5 min
          // (evitar dobles cuando el cron arranca 2 veces).
          const { data: existing } = await sb
            .from("lead_timeline")
            .select("id")
            .eq("lead_id", leadId)
            .eq("type", "lead_message_received")
            .gte("timestamp", new Date(date.getTime() - 5 * 60_000).toISOString())
            .lte("timestamp", new Date(date.getTime() + 5 * 60_000).toISOString())
            .limit(1);
          if (existing && existing.length > 0) continue;

          await sb.from("lead_timeline").insert({
            lead_id: leadId,
            type: "lead_message_received",
            author: "lead",
            content: body,
            timestamp: date.toISOString(),
            metadata: {
              channel: "email",
              from,
              subject: (parsed.subject ?? "").slice(0, 300),
              message_id: parsed.messageId ?? null,
            },
          });
          result.inserted++;

          // Marca leido para que el cron siguiente no lo vea.
          await client.messageFlagsAdd(String(uid), ["\\Seen"]);
        } catch (e) {
          result.errors.push(`uid ${uid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  // Actualiza cursor.
  await sb.from("system_config").upsert({
    key: "last_email_inbound_poll_at",
    value: new Date().toISOString(),
  });

  return result;
}
