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

const { rows: [s] } = await c.query(`
  SELECT id, name, status, whatsapp_normalized, whatsapp_lid, ai_paused_until,
         current_followup_number AS fu, reactivation_count AS rc, next_contact_date
    FROM leads WHERE name = 'Sara' LIMIT 1`);
console.log("══════════ Sara — datos del lead ══════════");
console.log(`  id=${s.id}  status=${s.status}  phone=${s.whatsapp_normalized}  lid=${s.whatsapp_lid}`);
console.log(`  fu=${s.fu}  rc=${s.rc}  next=${s.next_contact_date?.toISOString?.() ?? "NULL"}  paused=${s.ai_paused_until?.toISOString?.() ?? "no"}`);

console.log("\n══════════ Timeline COMPLETA de Sara ══════════");
const { rows: tl } = await c.query(`
  SELECT timestamp, type, author, LEFT(content, 200) AS content, metadata
    FROM lead_timeline WHERE lead_id = $1 ORDER BY timestamp ASC`, [s.id]);
for (const t of tl) {
  console.log(`  ${t.timestamp.toISOString().slice(0,19).replace("T"," ")}Z  ${t.type.padEnd(28)} by=${(t.author??"-").padEnd(8)} ${t.content}`);
}

console.log(`\nTotal eventos: ${tl.length}`);
console.log(`\n══════════ Mensajes en message_send_log a Sara ══════════`);
const { rows: msl } = await c.query(`
  SELECT sent_at, success, retry_count, LEFT(message_body, 80) AS preview, error_message
    FROM message_send_log WHERE to_number = $1 ORDER BY sent_at ASC`, [s.whatsapp_normalized]);
for (const m of msl) {
  console.log(`  ${m.sent_at?.toISOString?.()?.slice(0,19) ?? "—"}Z  ok=${m.success}  retry=${m.retry_count}  "${m.preview}"`);
}

await c.end();
