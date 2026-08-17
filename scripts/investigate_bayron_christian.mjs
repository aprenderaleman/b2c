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

for (const [name, label] of [["bayron", "BAYRON"], ["Christian", "CHRISTIAN"]]) {
  const { rows: leads } = await c.query(
    `SELECT id, name, status, whatsapp_normalized, whatsapp_lid,
            ai_paused_until, current_followup_number AS fu, reactivation_count AS rc,
            next_contact_date
       FROM leads WHERE LOWER(name) = LOWER($1)`, [name]);
  for (const l of leads) {
    console.log(`\n══════════ ${label} (${l.id.slice(0,8)}) ══════════`);
    console.log(`  status=${l.status}  phone=${l.whatsapp_normalized}  lid=${l.whatsapp_lid}`);
    console.log(`  fu=${l.fu}  rc=${l.rc}  next=${l.next_contact_date?.toISOString?.() ?? "NULL"}  paused=${l.ai_paused_until?.toISOString?.() ?? "no"}`);
    const { rows: tl } = await c.query(`
      SELECT timestamp, type, author, LEFT(content, 200) AS content
        FROM lead_timeline WHERE lead_id = $1 AND timestamp > NOW() - INTERVAL '2 days'
        ORDER BY timestamp ASC`, [l.id]);
    console.log(`  Timeline últimas 2 días (${tl.length} eventos):`);
    for (const t of tl) {
      console.log(`    ${t.timestamp.toISOString().slice(0,19)}Z  ${t.type.padEnd(28)} by=${(t.author??"-").padEnd(8)}  ${t.content}`);
    }
  }
}

await c.end();
