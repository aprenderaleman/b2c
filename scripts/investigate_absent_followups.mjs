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

console.log("══════════ Leads en absent_followup_* / trial_absent ══════════");
const r1 = await c.query(`
  SELECT l.id, l.name, l.status, l.current_followup_number AS fu,
         l.created_at, l.updated_at, l.next_contact_date
    FROM leads l
   WHERE l.status IN ('trial_absent','absent_followup_1','absent_followup_2')
   ORDER BY l.created_at`);
for (const r of r1.rows) {
  console.log(`\n  ── ${r.name} (${r.id.slice(0,8)}) ──`);
  console.log(`     status=${r.status}  fu=${r.fu}  created=${r.created_at?.toISOString?.()?.slice(0,16)}`);
  console.log(`     updated=${r.updated_at?.toISOString?.()?.slice(0,16)}  next_contact=${r.next_contact_date?.toISOString?.()?.slice(0,16) ?? "NULL ⚠"}`);

  // Timeline relevante
  const r2 = await c.query(`
    SELECT timestamp, type, author, LEFT(content, 100) AS content
      FROM lead_timeline
     WHERE lead_id = $1
     ORDER BY timestamp ASC`, [r.id]);
  console.log(`     Timeline (${r2.rows.length} eventos):`);
  for (const e of r2.rows) {
    console.log(`       ${e.timestamp.toISOString().slice(0,16)}  ${e.type.padEnd(22)}  ${(e.author??"—").padEnd(8)}  ${e.content}`);
  }
}

console.log("\n══════════ ¿Cuándo corrió tick_absent_followups por última vez? ══════════");
// El job se loguea? Revisamos si hay agent_run_log para él
const r3 = await c.query(`
  SELECT agent_name, started_at, finished_at, leads_processed, errors_count, notes
    FROM agent_run_log
   WHERE agent_name LIKE '%absent%' OR agent_name LIKE '%agent_5%'
   ORDER BY started_at DESC LIMIT 10`);
if (r3.rows.length === 0) {
  console.log("  (no hay agent_run_log para tick_absent_followups — el job corre pero no se loggea allí)");
}
for (const r of r3.rows) console.log(`  ${r.agent_name}  ${r.started_at?.toISOString?.()?.slice(0,16)}  processed=${r.leads_processed}  errors=${r.errors_count}`);

await c.end();
