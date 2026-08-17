#!/usr/bin/env node
/**
 * Sabine reclamó 4 clases que dió en la plataforma LiveKit pero el aula
 * no las facturó automáticamente (bug LiveKit: no llamó /api/aula/[id]/end
 * con la duración). Las facturamos ahora manualmente:
 *
 *   1. 24-abr 14:00 — individual Maria Eugenia → 1h × 15€ = 15€
 *   2. 27-abr 07:15 — group Morgens (Nicolas, Javier, Victoria) → 2h × 17€ = 34€
 *   3. 29-abr 07:00 — group Morgens (Nicolas, Victoria, Javier) → 2h × 17€ = 34€
 *   4. 29-abr 10:00 — individual Maria Eugenia → 1h × 15€ = 15€
 *
 * Total: +98€ a Sabine. Nuevo total abril: 286,50€ + 98€ = 384,50€.
 *
 * Tras esto: desmarcar paid=false para que Gelfis transfiera los 98€
 * extras y vuelva a marcar como pagado (el toggle re-disparará el email
 * con la factura PDF corregida).
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
  // Buscar Sabine
  const { rows: [sab] } = await c.query(`
    SELECT t.id, t.rate_individual_cents, t.rate_group_cents, t.currency
      FROM teachers t JOIN users u ON u.id = t.user_id
     WHERE u.full_name = 'Sabine Arning'`);
  if (!sab) throw new Error("Sabine no encontrada");
  const rateInd = sab.rate_individual_cents;  // 1500 = 15€
  const rateGrp = sab.rate_group_cents;        // 1700 = 17€

  const TARGETS = [
    { date: '2026-04-24', time: '14:00', type: 'individual', billed_hours: 1, duration_min: 60, rate: rateInd },
    { date: '2026-04-27', time: '07:15', type: 'group',      billed_hours: 2, duration_min: 120, rate: rateGrp },
    { date: '2026-04-29', time: '07:00', type: 'group',      billed_hours: 2, duration_min: 120, rate: rateGrp },
    { date: '2026-04-29', time: '10:00', type: 'individual', billed_hours: 1, duration_min: 60, rate: rateInd },
  ];

  for (const t of TARGETS) {
    // Buscar la clase exacta
    const { rows } = await c.query(`
      SELECT id, scheduled_at, billed_hours, type
        FROM classes
       WHERE teacher_id = $1
         AND scheduled_at::date = $2
         AND scheduled_at::time = $3
         AND type = $4
         AND status = 'completed'
       LIMIT 1`,
      [sab.id, t.date, t.time, t.type]);
    if (rows.length !== 1) {
      throw new Error(`Esperaba 1 clase ${t.date} ${t.time} ${t.type}, encontré ${rows.length}`);
    }
    const cls = rows[0];

    // 1. Update billed_hours
    await c.query(
      `UPDATE classes SET billed_hours = $1, actual_duration_minutes = $2 WHERE id = $3`,
      [t.billed_hours, t.duration_min, cls.id],
    );

    // 2. Insert class_hours_log
    const amount = t.billed_hours * t.rate;
    await c.query(`
      INSERT INTO class_hours_log
        (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (class_id) DO UPDATE SET
        duration_minutes = EXCLUDED.duration_minutes,
        rate_at_time     = EXCLUDED.rate_at_time,
        amount_cents     = EXCLUDED.amount_cents,
        currency         = EXCLUDED.currency`,
      [cls.id, sab.id, t.billed_hours * 60, t.rate / 100, amount, sab.currency, cls.scheduled_at],
    );

    console.log(`  ✓ ${t.date} ${t.time} ${t.type}  bh=${t.billed_hours}  ${amount/100}€  (clase ${cls.id})`);
  }

  // 3. Re-rollup teacher_earnings(Sabine, abril)
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
      AND chl.created_at >= '2026-04-01' AND chl.created_at < '2026-05-01'
    GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
    ON CONFLICT (teacher_id, month) DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      classes_count = EXCLUDED.classes_count,
      amount_cents  = EXCLUDED.amount_cents,
      currency      = EXCLUDED.currency,
      updated_at    = now()
    RETURNING amount_cents, classes_count`, [sab.id]);
  console.log(`\n  ✓ teacher_earnings actualizado: ${rollup.classes_count} clases · ${rollup.amount_cents/100}€`);

  // 4. Desmarcar paid (Gelfis transferirá los 98€ adicionales y volverá a marcar)
  await c.query(`
    UPDATE teacher_earnings
       SET paid = FALSE, paid_at = NULL
     WHERE teacher_id = $1 AND month = '2026-04-01'`, [sab.id]);
  console.log(`  ✓ paid=FALSE (pendiente de complementar el pago)`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación
const { rows: payroll } = await c.query(`
  SELECT u.full_name, te.classes_count, te.total_minutes,
         te.amount_cents/100.0 AS eur, te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY te.amount_cents DESC`);
console.log(`\n══════════ NÓMINA ABRIL 2026 (post-fix) ══════════`);
let total = 0;
for (const r of payroll) {
  console.log(`  ${(r.full_name??"—").padEnd(20)} ${String(r.classes_count).padStart(2)} cls · ${String(r.total_minutes).padStart(4)}min → ${String(r.eur).padStart(7)} EUR  ${r.paid?"PAGADO":"pendiente"}`);
  total += Number(r.eur);
}
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  TOTAL: ${total.toFixed(2)} EUR`);

await c.end();
