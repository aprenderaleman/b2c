#!/usr/bin/env node
/**
 * Sube la "media clase" de Maria Eugenia 20-abr 12:41 a 1h completa.
 *   - class_hours_log: duration_minutes 30 → 60, amount_cents 750 → 1500
 *   - billed_hours en classes ya está en 1 (no cambia)
 *   - re-rollup teacher_earnings(Sabine, abril)
 *
 * Decisión Gelfis 2026-05-01: cambia la política previa del 29-abr.
 */
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
await c.query("BEGIN");

try {
  // Localizar la clase exacta
  const { rows: meCls } = await c.query(`
    SELECT c.id, c.teacher_id, t.rate_individual_cents
      FROM classes c
      JOIN class_participants cp ON cp.class_id = c.id
      JOIN students s ON s.id = cp.student_id
      JOIN users u ON u.id = s.user_id
      JOIN teachers t ON t.id = c.teacher_id
     WHERE u.full_name = 'Maria Eugenia'
       AND c.notes_admin = 'on_demand'
       AND c.started_at::date = '2026-04-20'
       AND c.started_at::time >= '12:00' AND c.started_at::time < '13:30'
     LIMIT 1`);
  if (meCls.length !== 1) throw new Error(`Esperaba 1 clase, encontré ${meCls.length}`);
  const me = meCls[0];

  await c.query(`
    UPDATE class_hours_log
       SET duration_minutes = 60,
           rate_at_time     = 15,
           amount_cents     = 1500
     WHERE class_id = $1`, [me.id]);
  console.log(`  ✓ Maria Eugenia 20-abr 12:41 → 60min × 15€/h = 15€ (era media clase 7,50€)`);

  // Re-rollup
  await c.query(`
    INSERT INTO teacher_earnings (teacher_id, month, total_minutes, classes_count, amount_cents, currency)
    SELECT
      chl.teacher_id,
      DATE_TRUNC('month', chl.created_at)::date,
      SUM(chl.duration_minutes)::int,
      COUNT(*)::int,
      SUM(chl.amount_cents)::int,
      MAX(chl.currency)
    FROM class_hours_log chl
    WHERE chl.teacher_id = $1
      AND chl.created_at >= '2026-04-01' AND chl.created_at < '2026-05-01'
    GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
    ON CONFLICT (teacher_id, month) DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      classes_count = EXCLUDED.classes_count,
      amount_cents  = EXCLUDED.amount_cents,
      updated_at    = now()`, [me.teacher_id]);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}

const { rows } = await c.query(`
  SELECT u.full_name, te.classes_count, te.total_minutes, te.amount_cents/100.0 AS eur, te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY te.amount_cents DESC`);
console.log(`\n══════════ NÓMINA ABRIL 2026 ══════════`);
let total = 0;
for (const r of rows) {
  console.log(`  ${(r.full_name??"—").padEnd(20)} ${String(r.classes_count).padStart(2)} cls · ${String(r.total_minutes).padStart(4)}min → ${String(r.eur).padStart(7)} EUR  ${r.paid?"PAGADO":"pendiente"}`);
  total += Number(r.eur);
}
console.log(`  TOTAL: ${total.toFixed(2)} EUR`);
await c.end();
