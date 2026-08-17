#!/usr/bin/env node
/**
 * Diagnóstico de la cadena de mensajería WhatsApp.
 * Ejecuta queries SOLO LECTURA contra la DB para entender:
 *  - Qué leads están atascados / fallidos
 *  - Por qué agent_0 dice "due=3 processed=0"
 *  - Estado de outbound_queue
 *  - Últimos errores con detalle
 *  - Si el endpoint /internal/whatsapp-status responde
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

// 1. Las 3 leads que agent_0 dice "due"
console.log("══════════ 1. LEADS DUE (next_contact_date <= NOW) ══════════");
const { rows: due } = await db.query(`
  SELECT id, name, status, current_followup_number AS cfn, next_contact_date,
         whatsapp_normalized, last_message_seen_at, messages_seen_count,
         ai_paused_until, whatsapp_instance
    FROM leads
   WHERE next_contact_date <= NOW()
     AND status NOT IN ('lost','converted','needs_human','cold')
   ORDER BY next_contact_date ASC`);
for (const l of due) {
  console.log(`  ${l.id.slice(0,8)}  ${(l.name ?? "—").padEnd(20)}  status=${l.status}  fu=${l.cfn}  due=${l.next_contact_date.toISOString().slice(0,16)}  paused_until=${l.ai_paused_until?.toISOString?.()?.slice(0,16) ?? "—"}  seen=${l.messages_seen_count ?? 0}  inst=${l.whatsapp_instance ?? "—"}`);
}

// 2. Leads atascados (>48h sin actividad y no lost/converted)
console.log("\n══════════ 2. LEADS ATASCADOS (>24h sin update) ══════════");
const { rows: stuck } = await db.query(`
  SELECT id, name, status, current_followup_number AS cfn,
         updated_at, next_contact_date, ai_paused_until,
         EXTRACT(EPOCH FROM (NOW() - updated_at))/3600 AS hours_idle
    FROM leads
   WHERE status NOT IN ('lost','converted','needs_human','cold')
     AND updated_at < NOW() - INTERVAL '24 hours'
   ORDER BY updated_at ASC
   LIMIT 20`);
for (const l of stuck) {
  console.log(`  ${l.id.slice(0,8)}  ${(l.name ?? "—").padEnd(20)}  status=${l.status}  fu=${l.cfn}  ${Number(l.hours_idle).toFixed(1)}h sin update  next=${l.next_contact_date?.toISOString?.()?.slice(0,16) ?? "—"}  paused_until=${l.ai_paused_until?.toISOString?.()?.slice(0,16) ?? "—"}`);
}

// 3. Últimos send_failed con detalle
console.log("\n══════════ 3. SEND_FAILED en 24h con detalle ══════════");
const { rows: fails } = await db.query(`
  SELECT lt.id, lt.lead_id, lt.timestamp, lt.content,
         l.name, l.status
    FROM lead_timeline lt
    JOIN leads l ON l.id = lt.lead_id
   WHERE lt.type = 'send_failed'
     AND lt.timestamp > NOW() - INTERVAL '24 hours'
   ORDER BY lt.timestamp DESC`);
for (const f of fails) {
  console.log(`  ${f.timestamp.toISOString().slice(0,16)}  lead=${f.lead_id.slice(0,8)}  ${(f.name ?? "—").padEnd(20)}  status=${f.status}`);
  console.log(`     ${(f.content ?? "").slice(0, 200)}`);
}

// 4. Outbound queue
console.log("\n══════════ 4. OUTBOUND_QUEUE ══════════");
try {
  const { rows: qStats } = await db.query(`
    SELECT status, COUNT(*)::int AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest
      FROM outbound_queue GROUP BY status ORDER BY status`);
  for (const r of qStats) {
    console.log(`  ${r.status.padEnd(20)}  n=${r.n}  oldest=${r.oldest?.toISOString?.()?.slice(0,16) ?? "—"}  newest=${r.newest?.toISOString?.()?.slice(0,16) ?? "—"}`);
  }
  const { rows: qDetail } = await db.query(`
    SELECT id, status, retry_count, last_error, scheduled_for, lead_id, kind, created_at
      FROM outbound_queue
     WHERE status NOT IN ('sent')
     ORDER BY created_at DESC
     LIMIT 20`);
  if (qDetail.length > 0) {
    console.log(`  Detalle de los ${qDetail.length} no-sent:`);
    for (const q of qDetail) {
      console.log(`     ${q.created_at.toISOString().slice(0,16)}  status=${q.status}  retries=${q.retry_count}  kind=${q.kind}  lead=${q.lead_id?.slice(0,8) ?? "—"}  err="${(q.last_error ?? "").slice(0,80)}"`);
    }
  }
} catch (e) {
  console.log(`  ✗ tabla outbound_queue: ${e.message}`);
}

// 5. lead_timeline últimos 20 eventos del bot
console.log("\n══════════ 5. ÚLTIMOS EVENTOS lead_timeline (cualquier tipo) ══════════");
const { rows: events } = await db.query(`
  SELECT lt.timestamp, lt.type, lt.lead_id, l.name, l.status,
         LEFT(lt.content, 80) AS content_preview
    FROM lead_timeline lt
    JOIN leads l ON l.id = lt.lead_id
   ORDER BY lt.timestamp DESC
   LIMIT 20`);
for (const e of events) {
  console.log(`  ${e.timestamp.toISOString().slice(0,16)}  ${e.type.padEnd(28)}  lead=${e.lead_id.slice(0,8)}  ${(e.name ?? "—").padEnd(15)}  ${e.content_preview ?? ""}`);
}

// 6. Probar el endpoint /internal/whatsapp-status si AGENTS_BASE_URL está configurado
console.log("\n══════════ 6. PROBE /internal/whatsapp-status ══════════");
const baseUrl = env.AGENTS_BASE_URL?.replace(/\/$/, "");
const secret  = env.AGENTS_INTERNAL_SECRET;
console.log(`  AGENTS_BASE_URL = ${baseUrl ?? "(no configurado en .env local)"}`);
console.log(`  AGENTS_INTERNAL_SECRET = ${secret ? "(configurado, " + secret.length + " chars)" : "(no configurado)"}`);
if (baseUrl && secret) {
  try {
    const r = await fetch(`${baseUrl}/internal/whatsapp-status`, {
      method: "GET", headers: { "X-Internal-Secret": secret },
      signal: AbortSignal.timeout(8000),
    });
    console.log(`  HTTP ${r.status} ${r.statusText}`);
    const body = await r.text();
    console.log(`  body: ${body.slice(0, 500)}`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
}

// 7. Probar /healthz también
if (baseUrl) {
  console.log("\n══════════ 7. PROBE /healthz ══════════");
  try {
    const r = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(8000) });
    console.log(`  HTTP ${r.status} ${r.statusText}`);
    const body = await r.text();
    console.log(`  body: ${body.slice(0, 200)}`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
}

await db.end();
