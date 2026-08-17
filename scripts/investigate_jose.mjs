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

console.log("══════════ LEADS JOSE ══════════");
const { rows: jose } = await c.query(`
  SELECT id, name, status, language, whatsapp_normalized, email,
         trial_scheduled_at, trial_zoom_link, ai_paused_until,
         created_at, updated_at
    FROM leads
   WHERE LOWER(name) LIKE '%jose%' OR LOWER(name) LIKE '%josé%'
   ORDER BY created_at DESC LIMIT 5`);
for (const l of jose) {
  console.log(`\n  ${l.id}  ${l.name}  status=${l.status}`);
  console.log(`    phone=${l.whatsapp_normalized}  email=${l.email}  lang=${l.language}`);
  console.log(`    trial_scheduled_at=${l.trial_scheduled_at?.toISOString?.() ?? "—"}`);
  console.log(`    paused=${l.ai_paused_until?.toISOString?.() ?? "—"}`);
  console.log(`    created=${l.created_at?.toISOString?.()?.slice(0,16)}`);
}

if (jose.length === 0) { await c.end(); process.exit(0); }
const target = jose[0];

console.log(`\n══════════ Clases de Jose (${target.id.slice(0,8)}) ══════════`);
const { rows: classes } = await c.query(`
  SELECT id, scheduled_at, started_at, ended_at, duration_minutes,
         actual_duration_minutes, billed_hours, status, title, is_trial,
         notes_admin
    FROM classes WHERE lead_id = $1 ORDER BY scheduled_at`, [target.id]);
for (const cl of classes) {
  console.log(`  ${cl.scheduled_at?.toISOString?.()?.slice(0,16)}  trial=${cl.is_trial}  status=${cl.status}  bh=${cl.billed_hours}  notes_admin="${cl.notes_admin?.slice(0,80) ?? ""}"`);
}

console.log(`\n══════════ Timeline Jose (últimos 30 eventos) ══════════`);
const { rows: tl } = await c.query(`
  SELECT timestamp, type, author, LEFT(content, 120) AS content
    FROM lead_timeline WHERE lead_id = $1
    ORDER BY timestamp DESC LIMIT 30`, [target.id]);
for (const t of tl.reverse()) {
  console.log(`  ${t.timestamp.toISOString().slice(0,19)}Z  ${t.type.padEnd(28)} by=${(t.author??"-").padEnd(8)}  ${t.content}`);
}

await c.end();
