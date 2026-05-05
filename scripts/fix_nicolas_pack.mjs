// Limpia las clases fantasma de Nicolas Abellan y ajusta su plan a 48 clases.
//
// Se conservan: 8 sesiones Nachmittags con Martin (feb-mar) + 10 sesiones
// Morgens con Sabine (desde 30.03) + 10 sesiones futuras.
// Se eliminan: 13 fantasmas Morgens (8 feb–18 mar), 5 testing/on_demand del
// 20 abr 19:33-20:03, 1 cancelled placeholder 20 abr 07:00, 2 scheduled
// duplicados (22 abr 07:00 y 27 abr 07:00).
//
// Plan: classes_purchased 80 → 48. Restantes pasarán a 12 (= 48 - 36 consumidas).

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

const DRY = process.argv.includes("--dry-run");
console.log(DRY ? "🔵 DRY RUN — no se modifica nada\n" : "🔴 EJECUCIÓN REAL — modificando BD\n");

// 1) Resolver student_id
const { rows: stu } = await c.query(`
  SELECT s.id, u.full_name, s.classes_purchased, s.classes_adjustment, s.classes_remaining
    FROM students s JOIN users u ON u.id=s.user_id
   WHERE u.email = 'carraasco.nico18@gmail.com'`);
if (stu.length === 0) { console.error("no encontrado"); process.exit(1); }
const nicolas = stu[0];
console.log(`Alumno: ${nicolas.full_name} | id=${nicolas.id}`);
console.log(`Antes: classes_purchased=${nicolas.classes_purchased} adj=${nicolas.classes_adjustment} remaining_stored=${nicolas.classes_remaining}\n`);

// 2) Identificar las 21 filas de class_participants a borrar
const { rows: toDelete } = await c.query(`
  SELECT cp.class_id, c.scheduled_at, c.status, c.billed_hours, c.title, c.notes_admin,
         c.duration_minutes
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1
     AND (
       -- Fantasmas Morgens (Sabine) entre 8 feb y 18 mar
       (c.title ILIKE '%A1 – B1 Morgens%' AND c.scheduled_at < '2026-03-30 00:00:00+00')
       OR
       -- Cancelled placeholder 20 abr 07:00
       (c.status = 'cancelled' AND c.scheduled_at::date = '2026-04-20')
       OR
       -- TESTING / on_demand del 20 abr noche
       (c.scheduled_at::date = '2026-04-20' AND c.scheduled_at::time >= '19:00')
       OR
       -- Scheduled duplicados (las completed reales del mismo día son las que se quedan)
       (c.status = 'scheduled' AND c.scheduled_at IN (
         '2026-04-22 07:00:00+00'::timestamptz,
         '2026-04-27 07:00:00+00'::timestamptz
       ))
     )
   ORDER BY c.scheduled_at`, [nicolas.id]);

console.log(`Filas de class_participants a borrar: ${toDelete.length}`);
for (const r of toDelete) {
  console.log(`  · ${r.scheduled_at.toISOString().slice(0,16)}  ${r.status.padEnd(9)}  bill=${r.billed_hours}  ${r.title?.slice(0,40) ?? ''}`);
}
console.log("");

// 3) Comprobación: contar lo que quedaría
const { rows: keepRows } = await c.query(`
  SELECT c.scheduled_at, c.title, c.billed_hours, c.status
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1
     AND cp.class_id NOT IN (${toDelete.map((_,i)=>`$${i+2}`).join(",") || "NULL"})
   ORDER BY c.scheduled_at`,
   [nicolas.id, ...toDelete.map(r => r.class_id)]);
console.log(`Filas que quedarían tras la limpieza: ${keepRows.length}`);
let billedSum = 0, completed = 0;
for (const r of keepRows) {
  if (r.status === 'completed' && r.billed_hours > 0) { billedSum += r.billed_hours; completed++; }
}
console.log(`  → completed con bill>0: ${completed} sesiones · suma billed_hours = ${billedSum}\n`);

// 4) Verificar la clase del 4 de mayo (suele estar en bill=0 sin attendance)
const { rows: may4 } = await c.query(`
  SELECT c.id, c.scheduled_at, c.status, c.billed_hours, c.duration_minutes, c.ended_at,
         (SELECT COUNT(*) FROM class_participants WHERE class_id=c.id) AS n_alumnos
    FROM classes c
    JOIN class_participants cp ON cp.class_id=c.id
   WHERE cp.student_id=$1 AND c.scheduled_at::date='2026-05-04'`, [nicolas.id]);
if (may4.length) {
  const m = may4[0];
  console.log(`Clase del 4 may: status=${m.status} bill=${m.billed_hours} ended=${m.ended_at?.toISOString()} alumnos=${m.n_alumnos}`);
  if (m.status === 'completed' && Number(m.billed_hours) === 0 && m.ended_at) {
    console.log(`  → la clase ocurrió (tiene ended_at) pero billed_hours=0; corrigiéndola a 2.`);
  }
}
console.log("");

// 5) Ejecutar cambios
if (!DRY) {
  await c.query("BEGIN");
  try {
    // a) borrar fantasmas
    await c.query(`
      DELETE FROM class_participants
       WHERE student_id = $1
         AND class_id = ANY($2::uuid[])`,
      [nicolas.id, toDelete.map(r => r.class_id)]);
    console.log(`✓ Borradas ${toDelete.length} filas de class_participants`);

    // b) ajustar plan
    await c.query(`
      UPDATE students SET classes_purchased = 48, classes_adjustment = 0, updated_at = NOW()
       WHERE id = $1`, [nicolas.id]);
    console.log(`✓ classes_purchased actualizado a 48 (adjustment=0)`);

    // c) corregir bill del 4 may si aplica
    if (may4.length && may4[0].status === 'completed' && Number(may4[0].billed_hours) === 0 && may4[0].ended_at) {
      await c.query(`UPDATE classes SET billed_hours = 2, updated_at = NOW() WHERE id = $1`, [may4[0].id]);
      console.log(`✓ Clase 4 may billed_hours: 0 → 2 (afecta a ${may4[0].n_alumnos} alumno/s)`);
    }

    await c.query("COMMIT");
    console.log("✓ COMMIT\n");
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("✗ ROLLBACK:", err.message);
    process.exit(1);
  }

  // 6) Estado final
  const { rows: after } = await c.query(`
    SELECT classes_purchased, classes_adjustment, classes_consumed, classes_remaining
      FROM v_student_packs WHERE student_id = $1`, [nicolas.id]);
  console.log("ESTADO FINAL (v_student_packs):");
  console.log(after[0]);
}

await c.end();
