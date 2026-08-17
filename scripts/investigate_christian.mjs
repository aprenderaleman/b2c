import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

const { rows: leads } = await c.query(`
  SELECT id, name, status, current_followup_number, language,
         whatsapp_normalized, last_message_seen_at, messages_seen_count,
         trial_scheduled_at, ai_paused_until, created_at
    FROM leads
   WHERE LOWER(name) LIKE '%christian%' OR LOWER(name) LIKE '%chris%'
   ORDER BY created_at DESC LIMIT 5`);
console.log("══════════ Christian leads ══════════");
for (const l of leads) {
  console.log(`  ${l.id}  ${l.name}  ${l.status}  fu=${l.current_followup_number}  trial=${l.trial_scheduled_at?.toISOString?.()}  created=${l.created_at?.toISOString?.()}`);
}

if (leads.length === 0) { await c.end(); process.exit(0); }
const leadId = leads[0].id;

console.log(`\n══════════ Timeline completa de ${leadId} ══════════`);
const { rows: timeline } = await c.query(`
  SELECT timestamp, type, author, LEFT(content, 200) AS content,
         metadata
    FROM lead_timeline
   WHERE lead_id = $1
   ORDER BY timestamp ASC`, [leadId]);
for (const t of timeline) {
  console.log(`  ${t.timestamp.toISOString().slice(11,23)}  ${t.type.padEnd(28)}  ${(t.author ?? "—").padEnd(8)}  ${t.content}`);
  if (t.metadata && Object.keys(t.metadata).length > 0) {
    console.log(`         metadata: ${JSON.stringify(t.metadata)}`);
  }
}

console.log(`\n══════════ message_send_log para Christian ══════════`);
const { rows: msgs } = await c.query(`
  SELECT sent_at, instance, to_number, success, retry_count,
         LEFT(message_body, 60) AS preview, message_id, kind, error_message
    FROM message_send_log
   WHERE to_number = $1
   ORDER BY sent_at ASC`, [leads[0].whatsapp_normalized]);
for (const m of msgs) {
  console.log(`  ${m.sent_at?.toISOString?.()?.slice(11,23) ?? "—"}  kind=${m.kind ?? "—"}  ok=${m.success}  retry=${m.retry_count}  msg_id=${m.message_id?.slice(0,20) ?? "—"}`);
  console.log(`         "${m.preview}"`);
  if (m.error_message) console.log(`         err: ${m.error_message}`);
}

console.log(`\n══════════ outbound_queue para Christian (cualquier estado) ══════════`);
const { rows: queue } = await c.query(`
  SELECT id, status, lead_id, kind, created_at, processed_at,
         LEFT(text, 80) AS preview
    FROM outbound_queue
   WHERE lead_id = $1
   ORDER BY created_at`, [leadId]);
for (const q of queue) {
  console.log(`  ${q.created_at?.toISOString?.()?.slice(11,23)}  status=${q.status}  kind=${q.kind}  proc=${q.processed_at?.toISOString?.()?.slice(11,23) ?? "—"}`);
  console.log(`         "${q.preview}"`);
}

await c.end();
