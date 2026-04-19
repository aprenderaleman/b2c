#!/usr/bin/env node
/** Mark Feb+Mar teacher_earnings as paid (Gelfis settled those out-of-band). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __d = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__d, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  UPDATE teacher_earnings
     SET paid = TRUE,
         paid_at = now(),
         payment_reference = 'backfill — pagado fuera del sistema antes del LMS'
   WHERE month < DATE_TRUNC('month', NOW())::date
     AND paid = FALSE
   RETURNING teacher_id, month, amount_cents`);

console.log(`Marked ${rows.length} rows as paid:`);
for (const r of rows) {
  console.log(`  ${r.month.toISOString().slice(0,10)}  teacher=${r.teacher_id.slice(0,8)}  €${r.amount_cents/100}`);
}

// Show what remains pending now
const { rows: pending } = await c.query(`
  SELECT te.month, u.full_name, te.amount_cents
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users u    ON u.id = t.user_id
   WHERE te.paid = FALSE
   ORDER BY te.month, u.full_name`);
console.log("\nNow pending:");
let total = 0;
for (const p of pending) {
  console.log(`  ${p.month.toISOString().slice(0,10)}  ${p.full_name}  €${p.amount_cents/100}`);
  total += Number(p.amount_cents);
}
console.log(`  TOTAL: €${total/100}`);

await c.end();
