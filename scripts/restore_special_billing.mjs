#!/usr/bin/env node
/**
 * Restaura las 3 excepciones de facturación que el backfill rolló:
 *   1. Maria Eugenia 20-abr 12:41 (22min) → MEDIA clase (7,50 €)
 *   2. Ayman 03-abr 15min → Veronica NO cobra (acuerdo con Gelfis)
 *   3. Ayman 13-abr 11:02 → DUPLICADO (la clase real fue 09:45)
 *      → Veronica NO cobra + Ayman recupera la sesión
 *
 * Re-rollup teacher_earnings para Sabine + Veronica abril 2026 al final.
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
  // ── 1. Maria Eugenia "media clase" 20-abr 12:41 (22min on_demand) ──
  const { rows: meCls } = await c.query(`
    SELECT c.id, c.teacher_id, t.rate_individual_cents, t.currency
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
  if (meCls.length !== 1) throw new Error(`Esperaba 1 clase ME 20-abr 12:41, encontré ${meCls.length}`);
  const me = meCls[0];
  const halfAmount = Math.round(me.rate_individual_cents / 2);
  const rate = me.rate_individual_cents / 100;
  await c.query(`
    UPDATE class_hours_log
       SET duration_minutes = 30,
           rate_at_time     = $1,
           amount_cents     = $2
     WHERE class_id = $3`, [rate, halfAmount, me.id]);
  console.log(`  ✓ Maria Eugenia 20-abr 12:41 → 30min × ${rate}€/h = ${halfAmount/100}€`);

  // ── 2. Ayman 03-abr 15min — Veronica no cobra ──
  const { rows: aym } = await c.query(`
    SELECT id FROM classes
     WHERE notes_admin LIKE 'zoom_uuid=%'
       AND title ILIKE '%sin pago a Veronica%'
     LIMIT 1`);
  if (aym.length !== 1) throw new Error(`Esperaba 1 clase Ayman 03-abr sin-pago, encontré ${aym.length}`);
  const aymId = aym[0].id;
  const { rowCount: del } = await c.query(`DELETE FROM class_hours_log WHERE class_id = $1`, [aymId]);
  console.log(`  ✓ Ayman 03-abr 15min → eliminado del log (deletes=${del}). Veronica NO cobra.`);

  // ── 3. Ayman 13-abr 11:02 — DUPLICADO (la real fue a las 09:45) ──
  const { rows: dup } = await c.query(`
    SELECT id FROM classes
     WHERE notes_admin LIKE 'zoom_uuid=%'
       AND title ILIKE '%13-abr%host Nica%'
     LIMIT 1`);
  if (dup.length !== 1) throw new Error(`Esperaba 1 clase Ayman 13-abr duplicada, encontré ${dup.length}`);
  const dupId = dup[0].id;
  await c.query(`DELETE FROM class_hours_log WHERE class_id = $1`, [dupId]);
  await c.query(`UPDATE classes SET billed_hours = 0 WHERE id = $1`, [dupId]);
  console.log(`  ✓ Ayman 13-abr duplicado → bh=0 + log eliminado. Veronica NO cobra · Ayman recupera sesión.`);

  // ── 3. Re-rollup teacher_earnings(Sabine, Veronica, abril) ──
  for (const tid_q of [me.teacher_id, "(SELECT teacher_id FROM classes WHERE id = '" + aymId + "')"]) {
    // No: usamos el teacher_id directo
  }
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
    WHERE chl.created_at >= '2026-04-01' AND chl.created_at < '2026-05-01'
    GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
    ON CONFLICT (teacher_id, month) DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      classes_count = EXCLUDED.classes_count,
      amount_cents  = EXCLUDED.amount_cents,
      currency      = EXCLUDED.currency,
      updated_at    = now()`);
  console.log(`  ✓ teacher_earnings re-roleados para abril 2026`);

  await c.query("COMMIT");
  console.log(`\n✓ COMMIT`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificar
const { rows: payroll } = await c.query(`
  SELECT u.full_name, te.classes_count, te.total_minutes,
         te.amount_cents / 100.0 AS eur, te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users    u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY te.amount_cents DESC`);
console.log(`\n══════════ NÓMINA FINAL ABRIL 2026 ══════════`);
let total = 0;
for (const r of payroll) {
  console.log(`  ${(r.full_name??"—").padEnd(20)} ${String(r.classes_count).padStart(2)} cls · ${String(r.total_minutes).padStart(4)}min → ${String(r.eur).padStart(7)} EUR  ${r.paid?"PAGADO":"pendiente"}`);
  total += Number(r.eur);
}
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  TOTAL: ${total.toFixed(2)} EUR`);

await c.end();
