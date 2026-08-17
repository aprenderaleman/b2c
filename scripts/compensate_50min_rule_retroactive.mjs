#!/usr/bin/env node
/**
 * Opción B — la regla 50min=1clase aplica solo a clases futuras.
 * Compensa con classes_adjustment los créditos que perdieron retroactivamente
 * los estudiantes con sesiones >50min ya completadas.
 *
 * Decisión Gelfis 2026-05-02.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

const REASON = "Compensación cambio regla 50min retroactivo (Opción B, 2026-05-02). Las clases pasadas se cuentan 1 sesión = 1 unidad como antes; la regla nueva aplica solo desde hoy.";

await c.query("BEGIN");
try {
  // Para cada estudiante: delta = sessions_count − sum(billed_hours) (lo que se "perdió")
  const { rows } = await c.query(`
    SELECT s.id, u.full_name, s.classes_adjustment AS adj,
           COALESCE(SUM(c.billed_hours)::int, 0) AS hours_consumed,
           COUNT(c.id)::int AS sessions_count
      FROM students s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN class_participants cp ON cp.student_id = s.id
      LEFT JOIN classes c ON c.id = cp.class_id
        AND c.status = 'completed' AND c.billed_hours > 0 AND cp.counts_as_session = TRUE
     GROUP BY s.id, u.full_name, s.classes_adjustment`);

  let touched = 0;
  for (const r of rows) {
    const delta = Number(r.hours_consumed) - Number(r.sessions_count);  // unidades perdidas vs COUNT
    if (delta <= 0) continue;
    const newAdj = Number(r.adj) + delta;

    // Audit row
    await c.query(`
      INSERT INTO student_class_adjustments (student_id, admin_user_id, delta, reason, new_adjustment)
      VALUES ($1, NULL, $2, $3, $4)`,
      [r.id, delta, REASON, newAdj]);

    // Update students.classes_adjustment (trigger recompute_classes_remaining auto-fires)
    await c.query(`UPDATE students SET classes_adjustment = $1 WHERE id = $2`, [newAdj, r.id]);

    console.log(`  ✓ ${(r.full_name??'').padEnd(28)} adj ${r.adj} → ${newAdj}  (+${delta})`);
    touched++;
  }
  console.log(`\n${touched} estudiantes compensados.`);

  await c.query("COMMIT");
  console.log("✓ COMMIT\n");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación
const { rows: vfy } = await c.query(`
  SELECT u.full_name, s.classes_purchased AS purch, s.classes_adjustment AS adj, s.classes_remaining AS rem
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE s.classes_remaining > 0 OR s.classes_purchased > 0
   ORDER BY u.full_name`);
console.log("══════════ Saldos finales ══════════");
for (const r of vfy) {
  console.log(`  ${(r.full_name??'').padEnd(28)}  pack=${r.purch}  adj=${r.adj}  remaining=${r.rem}`);
}
await c.end();
