#!/usr/bin/env node
/**
 * Veronica (profe) confirmó 2 clases con Ayman el 13-abr. La 2ª (11:02)
 * no se facturó. Decisión Gelfis 2026-05-01: NO hacer transferencia extra
 * de 17€ — se acumula en la nómina de MAYO 2026.
 *
 * Estrategia: insertar class_hours_log con created_at = 2026-05-01 (hoy)
 * para que el rollup de mayo lo incluya, manteniendo abril intacto.
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
  // Buscar Veronica (profe)
  const { rows: [vero] } = await c.query(`
    SELECT t.id, t.rate_individual_cents, t.currency
      FROM teachers t JOIN users u ON u.id = t.user_id
     WHERE u.full_name ILIKE 'Veronica%Fusco%'`);
  if (!vero) throw new Error("Veronica Fusco no encontrada");

  // Buscar la clase 13-abr 11:02 con Ayman
  const { rows: cls } = await c.query(`
    SELECT cls.id, cls.scheduled_at, cls.started_at, cls.billed_hours, cls.status,
           (SELECT u.full_name FROM class_participants cp
              JOIN students s ON s.id=cp.student_id
              JOIN users u ON u.id=s.user_id
            WHERE cp.class_id = cls.id LIMIT 1) AS student_name
      FROM classes cls
     WHERE cls.teacher_id = $1
       AND cls.scheduled_at::date = '2026-04-13'
       AND cls.scheduled_at::time >= '10:30' AND cls.scheduled_at::time < '12:00'
     ORDER BY cls.scheduled_at`,
    [vero.id]);

  console.log("Clases 13-abr Veronica (10:30-12:00):");
  for (const r of cls) {
    console.log(`  ${r.scheduled_at.toISOString().slice(0,16)}  status=${r.status}  bh=${r.billed_hours}  student=${r.student_name}`);
  }

  // Filtrar la de Ayman 11:02
  const target = cls.find(r =>
    (r.student_name ?? "").toLowerCase().includes("ayman") &&
    r.scheduled_at.toISOString().slice(11,16) >= "10:50" &&
    r.scheduled_at.toISOString().slice(11,16) <= "11:30"
  ) ?? cls.find(r => (r.student_name ?? "").toLowerCase().includes("ayman"));

  if (!target) throw new Error("No encontré clase 13-abr ~11:02 Veronica/Ayman");

  console.log(`\n→ Target: clase ${target.id} ${target.scheduled_at.toISOString().slice(0,16)} (${target.student_name})`);

  // ¿Ya tiene log? Si sí, no duplicar
  const { rows: existing } = await c.query(
    `SELECT id, amount_cents, created_at FROM class_hours_log WHERE class_id = $1`,
    [target.id]);
  if (existing.length > 0) {
    console.log(`  ⚠ Ya existe class_hours_log (amount=${existing[0].amount_cents}, created=${existing[0].created_at.toISOString().slice(0,10)}). Aborto para no duplicar.`);
    await c.query("ROLLBACK");
    process.exit(0);
  }

  // Insertar con created_at = 2026-05-01 12:00 UTC para que cuente en mayo
  const amount = vero.rate_individual_cents; // 1h × 17€ = 1700
  await c.query(`
    INSERT INTO class_hours_log
      (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
    VALUES ($1, $2, 60, $3, $4, $5, '2026-05-01 12:00:00+00')`,
    [target.id, vero.id, vero.rate_individual_cents / 100, amount, vero.currency]);
  console.log(`  ✓ class_hours_log insertado (created_at=2026-05-01, ${amount/100}€)`);

  // Update billed_hours en la clase si está en 0
  await c.query(
    `UPDATE classes SET billed_hours = 1, actual_duration_minutes = COALESCE(actual_duration_minutes, 60)
      WHERE id = $1 AND COALESCE(billed_hours,0) = 0`,
    [target.id]);

  // Rollup mayo
  const { rows: [rollup] } = await c.query(`
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
      AND chl.created_at >= '2026-05-01' AND chl.created_at < '2026-06-01'
    GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
    ON CONFLICT (teacher_id, month) DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      classes_count = EXCLUDED.classes_count,
      amount_cents  = EXCLUDED.amount_cents,
      currency      = EXCLUDED.currency,
      updated_at    = now()
    RETURNING amount_cents, classes_count`, [vero.id]);
  console.log(`  ✓ teacher_earnings(Veronica, mayo): ${rollup.classes_count} cls · ${rollup.amount_cents/100}€`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

const { rows } = await c.query(`
  SELECT u.full_name, te.month, te.classes_count, te.amount_cents/100.0 AS eur, te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users u ON u.id = t.user_id
   WHERE u.full_name ILIKE 'Veronica%Fusco%'
   ORDER BY te.month DESC LIMIT 4`);
console.log(`\n══════════ Veronica — últimos meses ══════════`);
for (const r of rows) {
  console.log(`  ${r.month.toISOString().slice(0,7)}  ${r.classes_count} cls · ${r.eur}€  ${r.paid?"PAGADO":"pendiente"}`);
}
await c.end();
