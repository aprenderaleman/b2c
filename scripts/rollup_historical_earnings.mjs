#!/usr/bin/env node
/**
 * Populate class_hours_log + teacher_earnings for the 53 historical classes
 * we just backfilled from Zoom. Uses the new split grupal/individual rates
 * per teacher (migration 023). Re-runnable: UNIQUE(class_id) on
 * class_hours_log makes it idempotent; teacher_earnings is upserted by
 * (teacher_id, month).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(path.resolve(__dirname, ".."), ".env");
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
await db.query("BEGIN");

// 1) Insert/overwrite a class_hours_log row for every completed class with a teacher.
//    Pay based on class.type + teacher split rates + class.billed_hours.
const { rows: insertedLog } = await db.query(`
  INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
  SELECT
    c.id,
    c.teacher_id,
    c.billed_hours * 60                                                                       AS duration_minutes,
    CASE c.type WHEN 'individual' THEN t.rate_individual_cents ELSE t.rate_group_cents END / 100.0 AS rate_at_time,
    c.billed_hours *
      (CASE c.type WHEN 'individual' THEN t.rate_individual_cents ELSE t.rate_group_cents END) AS amount_cents,
    t.currency,
    c.started_at
  FROM classes c
  JOIN teachers t ON t.id = c.teacher_id
  WHERE c.status = 'completed'
    AND c.billed_hours > 0
  ON CONFLICT (class_id) DO UPDATE SET
    amount_cents     = EXCLUDED.amount_cents,
    rate_at_time     = EXCLUDED.rate_at_time,
    duration_minutes = EXCLUDED.duration_minutes,
    currency         = EXCLUDED.currency
  RETURNING class_id, teacher_id, amount_cents
`);
console.log(`✓ class_hours_log rows written: ${insertedLog.length}`);

// 2) Upsert teacher_earnings monthly rollups from the hours log.
const { rows: rollups } = await db.query(`
  INSERT INTO teacher_earnings (teacher_id, month, total_minutes, classes_count, amount_cents, currency)
  SELECT
    chl.teacher_id,
    DATE_TRUNC('month', chl.created_at)::date                AS month,
    SUM(chl.duration_minutes)::int                            AS total_minutes,
    COUNT(*)::int                                             AS classes_count,
    SUM(chl.amount_cents)::int                                AS amount_cents,
    MAX(chl.currency)                                         AS currency
  FROM class_hours_log chl
  GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
  ON CONFLICT (teacher_id, month) DO UPDATE SET
    total_minutes = EXCLUDED.total_minutes,
    classes_count = EXCLUDED.classes_count,
    amount_cents  = EXCLUDED.amount_cents,
    currency      = EXCLUDED.currency,
    updated_at    = now()
  RETURNING teacher_id, month, amount_cents
`);
console.log(`✓ teacher_earnings rows: ${rollups.length}`);

await db.query("COMMIT");

// Verification
const { rows: view } = await db.query(`
  SELECT u.full_name,
         te.month,
         te.total_minutes / 60 AS hours,
         te.classes_count,
         te.amount_cents / 100.0 AS amount_eur,
         te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users u    ON u.id = t.user_id
   ORDER BY te.month, u.full_name
`);
console.log("\n=== teacher_earnings (authoritative table) ===");
for (const r of view) {
  console.log(`  ${r.month.toISOString().slice(0,10)}  ${r.full_name.padEnd(20)} ${String(r.hours).padStart(3)}h  ${String(r.classes_count).padStart(2)} clases  ${String(r.amount_eur).padStart(6)}€  paid=${r.paid}`);
}

await db.end();
