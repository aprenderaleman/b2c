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

console.log("══════════ TODAS las clases de Veronica abril 2026 (Zoom + DB) ══════════\n");

const { rows } = await c.query(`
  SELECT
    cls.scheduled_at,
    cls.started_at,
    cls.duration_minutes,
    cls.actual_duration_minutes,
    cls.billed_hours,
    cls.title,
    cls.notes_admin,
    chl.amount_cents,
    chl.duration_minutes AS log_min
    FROM classes cls
    LEFT JOIN class_hours_log chl ON chl.class_id = cls.id
    JOIN teachers t ON t.id = cls.teacher_id
    JOIN users u ON u.id = t.user_id
   WHERE u.full_name = 'Veronica Fusco'
     AND cls.scheduled_at >= '2026-04-01' AND cls.scheduled_at < '2026-05-01'
     AND cls.status = 'completed'
   ORDER BY cls.scheduled_at`);

let totalPaid = 0;
let countPaid = 0;
for (const r of rows) {
  const inLog = r.amount_cents != null;
  const flag = inLog ? `${r.amount_cents/100}€` : "(NO cobra)";
  console.log(`  ${r.scheduled_at.toISOString().slice(0,16)}  bh=${r.billed_hours}  dur=${r.duration_minutes}min  ${flag}`);
  console.log(`     "${r.title}"`);
  if (r.notes_admin && !r.notes_admin.startsWith("zoom_uuid=")) {
    console.log(`     notes: ${r.notes_admin.slice(0,80)}`);
  }
  if (inLog) {
    totalPaid += r.amount_cents;
    countPaid++;
  }
}
console.log(`\n  Total facturado: ${countPaid} clases · ${totalPaid/100}€`);

console.log("\n══════════ Lo que Veronica dice ══════════");
console.log("  12 clases × 17€ = 204€");
console.log(`  Diferencia: ${204 - totalPaid/100}€  (= 1 clase)`);

await c.end();
