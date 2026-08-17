#!/usr/bin/env node
/**
 * Quitar la clase duplicada de Veronica con Ayman del 13-abr 11:02:
 *   - eliminar class_hours_log (Veronica no cobra esa)
 *   - poner billed_hours=0 en classes (Ayman no consume sesión por esta)
 *   - re-rollup teacher_earnings de Veronica
 *
 * Razón: Ayman solo tiene 1h/día con Veronica. La instancia del 11:02 fue
 * probablemente una reconexión/test desde otro Zoom room (host Nica),
 * no una clase real adicional. La clase real es la de las 09:45.
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
  // Localizar la clase duplicada por título único (host Nica del 13-abr).
  const { rows } = await c.query(`
    SELECT id, teacher_id, scheduled_at, billed_hours
      FROM classes
     WHERE notes_admin LIKE 'zoom_uuid=%'
       AND title ILIKE '%13-abr%host Nica%'
     LIMIT 1`);
  if (rows.length !== 1) throw new Error(`Esperaba 1 clase, encontré ${rows.length}`);
  const dup = rows[0];
  console.log(`Clase duplicada: ${dup.id} @ ${dup.scheduled_at.toISOString()} bh=${dup.billed_hours}`);

  // 1. Eliminar el log de horas (Veronica no cobra)
  const { rowCount: delLog } = await c.query(
    `DELETE FROM class_hours_log WHERE class_id = $1`, [dup.id]);
  console.log(`  ✓ class_hours_log eliminado: ${delLog} fila(s)`);

  // 2. Poner billed_hours=0 en classes (trigger recalculará classes_remaining
  //    de Ayman → recupera 1 sesión que se contó de más).
  await c.query(`UPDATE classes SET billed_hours = 0 WHERE id = $1`, [dup.id]);
  console.log(`  ✓ classes.billed_hours = 0 (Ayman recupera la sesión)`);

  // 3. Re-rollup teacher_earnings(Veronica, abril)
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
      updated_at    = now()`, [dup.teacher_id]);
  console.log(`  ✓ teacher_earnings de Veronica re-roleado`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificar
const { rows: payroll } = await c.query(`
  SELECT u.full_name, te.classes_count, te.total_minutes,
         te.amount_cents / 100.0 AS eur
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users    u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY te.amount_cents DESC`);
console.log(`\n══════════ NÓMINA ABRIL 2026 (post-fix) ══════════`);
let total = 0;
for (const r of payroll) {
  console.log(`  ${(r.full_name??"—").padEnd(20)} ${String(r.classes_count).padStart(2)} cls · ${String(r.total_minutes).padStart(4)}min → ${String(r.eur).padStart(7)} EUR`);
  total += Number(r.eur);
}
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  TOTAL: ${total.toFixed(2)} EUR`);

// Estado de Ayman
const { rows: [aym] } = await c.query(`
  SELECT u.full_name, s.classes_purchased, s.classes_remaining
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.full_name = 'Ayman Kayali'`);
console.log(`\nAyman: ${aym.classes_purchased - aym.classes_remaining} consumidas / ${aym.classes_purchased} · restan ${aym.classes_remaining}`);

await c.end();
