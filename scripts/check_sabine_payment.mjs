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

const { rows } = await c.query(`
  SELECT te.id, te.amount_cents/100.0 AS eur, te.paid, te.paid_at, te.payment_reference,
         u.full_name, u.email
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users u    ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY u.full_name`);
for (const r of rows) {
  console.log(`${r.full_name.padEnd(20)}  ${r.eur} EUR  paid=${r.paid}  paid_at=${r.paid_at?.toISOString?.() ?? "—"}  ref=${r.payment_reference ?? "—"}`);
  console.log(`  email: ${r.email}`);
  console.log(`  earnings_id: ${r.id}`);
}

await c.end();
