#!/usr/bin/env node
/**
 * Fixes acordados con Gelfis (2026-04-27):
 *  1. Alejandro (xela_cigales@hotmail.es): classes_purchased 96 → 84.
 *  2. Clase 25-abr 08:30 (alejandro_seed): Sabine dio 120min reales con
 *     Alejandro. bh 0 → 2, started_at = scheduled_at (rellenamos NULL),
 *     actual_duration_minutes = 120. Pago: 2h × 15€ = 30€.
 *  3. Clase 25-abr 10:43 (2min reales): se queda bh=0 (falsa).
 *  4. Maria Eugenia 20-abr 12:41 (22min reales): "media clase".
 *     bh 0 → 1, class_hours_log con duration_min=30 (½) × 15€/h = 7.50€.
 *  5. Re-rollup teacher_earnings(Sabine, abril 2026).
 *
 * Camino A: dejamos que el trigger recalcule classes_remaining desde
 * class_participants. Maria Eugenia y Alejandro perderán el delta legacy
 * fantasma a cambio de quedar sincronizados.
 *
 * Todo en una transacción, idempotente vía ON CONFLICT.
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

try {
  // ────────────────────────────────────────────────────────
  // PASO 1: Alejandro classes_purchased 96 → 84
  // ────────────────────────────────────────────────────────
  const { rows: [alejBefore] } = await db.query(`
    SELECT s.id, s.classes_purchased, s.classes_remaining
      FROM students s JOIN users u ON u.id = s.user_id
     WHERE u.email = 'xela_cigales@hotmail.es'`);
  if (!alejBefore) throw new Error("Alejandro no encontrado");
  console.log(`Alejandro ANTES:  purchased=${alejBefore.classes_purchased}  remaining=${alejBefore.classes_remaining}`);

  await db.query(`UPDATE students SET classes_purchased = 84 WHERE id = $1`, [alejBefore.id]);

  // ────────────────────────────────────────────────────────
  // PASO 2: Clase Alejandro 25-abr 08:30 → bh=2, 120min
  // ────────────────────────────────────────────────────────
  const { rows: [alejCls] } = await db.query(`
    SELECT c.id, c.scheduled_at, c.started_at, c.ended_at, c.billed_hours,
           c.duration_minutes, c.actual_duration_minutes, c.teacher_id, c.type,
           t.rate_individual_cents, t.currency
      FROM classes c
      JOIN teachers t ON t.id = c.teacher_id
     WHERE c.notes_admin = 'alejandro_seed'
       AND c.status = 'completed'
       AND c.scheduled_at::date = '2026-04-25'
     LIMIT 1`);
  if (!alejCls) throw new Error("Clase 25-abr 08:30 alejandro_seed no encontrada");
  console.log(`Clase Alejandro 25-abr: id=${alejCls.id}  scheduled_at=${alejCls.scheduled_at.toISOString()}  bh ANTES=${alejCls.billed_hours}`);

  // started_at era NULL — lo seteamos a scheduled_at; ended_at ya existe.
  // actual_duration_minutes = 120 (lo que dio Sabine). billed_hours = 2 (>90min).
  await db.query(`
    UPDATE classes
       SET billed_hours            = 2,
           actual_duration_minutes = 120,
           started_at              = COALESCE(started_at, scheduled_at)
     WHERE id = $1`, [alejCls.id]);

  // class_hours_log para Alejandro: 2h × 15€ = 30€
  const alejAmount = 2 * alejCls.rate_individual_cents;
  const alejRate   = alejCls.rate_individual_cents / 100;
  await db.query(`
    INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
    VALUES ($1, $2, 120, $3, $4, $5, $6)
    ON CONFLICT (class_id) DO UPDATE SET
      duration_minutes = EXCLUDED.duration_minutes,
      rate_at_time     = EXCLUDED.rate_at_time,
      amount_cents     = EXCLUDED.amount_cents,
      currency         = EXCLUDED.currency`,
    [alejCls.id, alejCls.teacher_id, alejRate, alejAmount, alejCls.currency, alejCls.scheduled_at]);
  console.log(`  → bh=2, actual_duration=120min, class_hours_log: 120min × ${alejRate}€/h = ${alejAmount/100}€`);

  // ────────────────────────────────────────────────────────
  // PASO 3: Clase Maria Eugenia 20-abr 12:41 → bh=1, media tarifa
  // ────────────────────────────────────────────────────────
  const { rows: meCls } = await db.query(`
    SELECT c.id, c.started_at, c.teacher_id, c.type,
           t.rate_individual_cents, t.currency,
           cp.student_id
      FROM classes c
      JOIN teachers t ON t.id = c.teacher_id
      JOIN class_participants cp ON cp.class_id = c.id
      JOIN students s ON s.id = cp.student_id
      JOIN users u ON u.id = s.user_id
     WHERE u.full_name = 'Maria Eugenia'
       AND c.notes_admin = 'on_demand'
       AND c.started_at::date = '2026-04-20'
       AND c.started_at::time >= '12:00'
       AND c.started_at::time <  '13:30'`);
  if (meCls.length !== 1) throw new Error(`Esperaba 1 clase de Maria Eugenia 20-abr 12:41, encontré ${meCls.length}`);
  const me = meCls[0];
  console.log(`Clase Maria Eugenia 20-abr 12:41: id=${me.id}`);

  await db.query(`UPDATE classes SET billed_hours = 1 WHERE id = $1`, [me.id]);

  // class_hours_log para Maria Eugenia: media clase = 30min equivalentes × 15€/h = 7.50€
  const meAmount = Math.round(me.rate_individual_cents / 2);  // ½ rate
  const meRate   = me.rate_individual_cents / 100;
  await db.query(`
    INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
    VALUES ($1, $2, 30, $3, $4, $5, $6)
    ON CONFLICT (class_id) DO UPDATE SET
      duration_minutes = EXCLUDED.duration_minutes,
      rate_at_time     = EXCLUDED.rate_at_time,
      amount_cents     = EXCLUDED.amount_cents,
      currency         = EXCLUDED.currency`,
    [me.id, me.teacher_id, meRate, meAmount, me.currency, me.started_at]);
  console.log(`  → bh=1, class_hours_log: 30min × ${meRate}€/h = ${meAmount/100}€ (½ tarifa)`);

  // ────────────────────────────────────────────────────────
  // PASO 4: Re-rollup teacher_earnings(Sabine, abril 2026)
  // ────────────────────────────────────────────────────────
  await db.query(`
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
      currency      = EXCLUDED.currency,
      updated_at    = now()`,
    [alejCls.teacher_id]);

  await db.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await db.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  await db.end();
  process.exit(1);
}

// ────────────────────────────────────────────────────────
// Verificación final
// ────────────────────────────────────────────────────────
console.log("\n══════════ NÓMINA ABRIL 2026 (post-fix) ══════════");
const { rows: payroll } = await db.query(`
  SELECT u.full_name, te.classes_count, te.total_minutes,
         te.amount_cents / 100.0 AS eur, te.currency, te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users    u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY te.amount_cents DESC`);
let total = 0;
for (const r of payroll) {
  console.log(`  ${(r.full_name ?? "—").padEnd(20)} ${String(r.classes_count).padStart(2)} cls · ${String(r.total_minutes).padStart(4)}min total → ${String(r.eur).padStart(7)} ${r.currency}  ${r.paid ? "PAGADO" : "pendiente"}`);
  total += Number(r.eur);
}
console.log(`  ─────────────────────────────────────────────────────`);
console.log(`  TOTAL ABRIL: ${total.toFixed(2)} EUR`);

console.log("\n══════════ ALEJANDRO ══════════");
const { rows: [a] } = await db.query(`
  SELECT u.full_name, u.email, s.classes_purchased, s.classes_remaining
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.email = 'xela_cigales@hotmail.es'`);
console.log(`  ${a.full_name}  ${a.email}`);
console.log(`  consumidas: ${a.classes_purchased - a.classes_remaining} · restan: ${a.classes_remaining} / ${a.classes_purchased}`);

console.log("\n══════════ MARIA EUGENIA ══════════");
const { rows: [me] } = await db.query(`
  SELECT u.full_name, s.classes_purchased, s.classes_remaining
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.full_name = 'Maria Eugenia'`);
console.log(`  ${me.full_name}`);
console.log(`  consumidas: ${me.classes_purchased - me.classes_remaining} · restan: ${me.classes_remaining} / ${me.classes_purchased}`);

await db.end();
