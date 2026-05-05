// Corrige las horas de Florian de marzo y abril 2026.
//
// 1) Crea la clase del 13.4 Mon Abends (no asistieron) bill=2
// 2) Promueve la del 23.4 Thu Abends de scheduled → completed bill=2
// 3) Actualiza la del 28.4 Fernanda VIP bill=0 → 1
// 4) Actualiza teacher_earnings:
//    - Marzo 250 → 280 (Florian apunta 280; +30€ ajuste)
//    - Abril 113 → 213 (cálculo de las clases corregidas)
// 5) Inserta un teacher_payouts pendiente de 130€ por la diferencia.

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
const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

const DRY = process.argv.includes("--dry-run");
console.log(DRY ? "🔵 DRY RUN\n" : "🔴 EJECUTANDO\n");

const FLORIAN_ID = "544a84e9-7cc6-4f32-a342-21a5c14a137b";
const ABENDS_GID = "e9ad8e77-4a2a-4e52-abe8-4cf15e2b87b7"; // Deutsch A1 - B1 Abends
const CLASS_23_4 = "bb9a2c9c-03d8-4bae-9b49-78cf8c0b8bfb";
const CLASS_28_4 = "dd989610-f78b-44ea-a7b0-2bfb2f606172";

// Resolver student_id de Lydia y Luis Emilio (los miembros del grupo Abends antes del 19/4)
const { rows: members } = await c.query(`
  SELECT s.id AS student_id, u.email, u.full_name
    FROM students s JOIN users u ON u.id=s.user_id
   WHERE u.email IN ('lydia_mendoza@hotmail.com','viverosluisemilio@gmail.com')`);
const lydiaId  = members.find(m => m.email === "lydia_mendoza@hotmail.com").student_id;
const emilioId = members.find(m => m.email === "viverosluisemilio@gmail.com").student_id;
console.log(`Miembros pre-19/4 del grupo Abends:`);
console.log(`  Lydia       = ${lydiaId}`);
console.log(`  Luis Emilio = ${emilioId}\n`);

if (DRY) { await c.end(); process.exit(0); }

await c.query("BEGIN");
try {
  // 1) Crear clase 13.4 Mon Abends
  const newClass = await c.query(`
    INSERT INTO classes (
      type, teacher_id, group_id, scheduled_at,
      duration_minutes, actual_duration_minutes, status,
      title, billed_hours, is_trial, notes_admin, started_at, ended_at
    ) VALUES (
      'group', $1, $2, '2026-04-13 17:00:00+00'::timestamptz,
      120, 120, 'completed',
      'Deutsch A1 Abends', 2, false,
      'manual_no_show=true; reposicion: ningún alumno asistió, profesor estuvo disponible',
      '2026-04-13 17:00:00+00'::timestamptz, '2026-04-13 19:00:00+00'::timestamptz
    ) RETURNING id`,
    [FLORIAN_ID, ABENDS_GID]);
  const cls13 = newClass.rows[0].id;
  console.log(`✓ Creada clase 13.4: ${cls13}`);

  // Añadir participantes (lydia + emilio, attended=false)
  await c.query(`
    INSERT INTO class_participants (class_id, student_id, attended, counts_as_session, cancellation_type, minutes_attended)
    VALUES ($1, $2, false, true, 'no_show', 0),
           ($1, $3, false, true, 'no_show', 0)`,
    [cls13, lydiaId, emilioId]);
  console.log(`✓ Añadidos 2 participantes a la clase del 13.4 (no_show)`);

  // 2) Promover 23.4 scheduled → completed bill=2
  await c.query(`
    UPDATE classes
       SET status='completed', billed_hours=2,
           started_at = scheduled_at,
           ended_at   = scheduled_at + INTERVAL '120 minutes',
           actual_duration_minutes = 120,
           notes_admin = COALESCE(notes_admin || '; ','') || 'manual_no_show=true; profesor estuvo disponible',
           updated_at  = NOW()
     WHERE id = $1`, [CLASS_23_4]);
  await c.query(`
    UPDATE class_participants SET attended=false, cancellation_type='no_show'
     WHERE class_id=$1`, [CLASS_23_4]);
  console.log(`✓ Clase 23.4 promovida a completed bill=2`);

  // 3) Actualizar 28.4 Fernanda bill 0 → 1
  await c.query(`UPDATE classes SET billed_hours=1, actual_duration_minutes=60, updated_at=NOW() WHERE id=$1`, [CLASS_28_4]);
  console.log(`✓ Clase 28.4 Fernanda bill 0 → 1`);

  // 4) Actualizar teacher_earnings
  await c.query(`
    UPDATE teacher_earnings
       SET amount_cents=28000, total_minutes=total_minutes, updated_at=NOW()
     WHERE teacher_id=$1 AND month='2026-03-01'`, [FLORIAN_ID]);
  console.log(`✓ teacher_earnings marzo: 250 → 280€`);

  await c.query(`
    UPDATE teacher_earnings
       SET amount_cents=21300,
           classes_count = classes_count + 3,    -- 13.4 (nueva), 23.4 (nueva en BD ahora completed), 28.4 (ya estaba pero bill=0)
           total_minutes = total_minutes + 240 + 120 + 60,
           updated_at=NOW()
     WHERE teacher_id=$1 AND month='2026-04-01'`, [FLORIAN_ID]);
  console.log(`✓ teacher_earnings abril: 113 → 213€`);

  // 5) Crear payout pendiente por 130€
  await c.query(`
    INSERT INTO teacher_payouts (teacher_id, period_start, period_end, classes_count, hours_total, amount_cents, currency, status, notes)
    VALUES ($1, '2026-03-01', '2026-04-30', 3, 5, 13000, 'EUR', 'pending',
            'Diferencia detectada el 5/5: marzo +30€ (ajuste manual) + abril +100€ (clases 13.4, 23.4 no_show + 28.4 Fernanda + 30.4 1h)')`,
    [FLORIAN_ID]);
  console.log(`✓ Creado teacher_payouts pendiente por 130€`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT\n");
} catch (err) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", err.message);
  process.exit(1);
}

// Verificación final
const ver = await c.query(`SELECT month, classes_count, total_minutes, amount_cents, paid FROM teacher_earnings WHERE teacher_id=$1 ORDER BY month`, [FLORIAN_ID]);
console.log("teacher_earnings actualizado:");
for (const x of ver.rows) console.log(`  ${x.month.toISOString().slice(0,7)}: ${x.classes_count} clases · ${x.total_minutes} min · €${(x.amount_cents/100).toFixed(2)} | paid=${x.paid}`);

const pay = await c.query(`SELECT period_start, period_end, amount_cents, status, notes FROM teacher_payouts WHERE teacher_id=$1`, [FLORIAN_ID]);
console.log("\nteacher_payouts:");
for (const x of pay.rows) console.log(`  ${x.period_start.toISOString().slice(0,10)} → ${x.period_end.toISOString().slice(0,10)} : €${(x.amount_cents/100).toFixed(2)} ${x.status} | ${x.notes?.slice(0,60)}`);

console.log("\n=== Consumo de alumnos afectados (después) ===");
const sp = await c.query(`SELECT email, classes_purchased, classes_consumed, classes_remaining
                            FROM v_student_packs
                           WHERE email IN ('lydia_mendoza@hotmail.com','viverosluisemilio@gmail.com','ferkeller26@gmail.com')`);
for (const x of sp.rows) console.log(`  ${x.email.padEnd(36)} | plan=${x.classes_purchased} | consumed=${x.classes_consumed} | remaining=${x.classes_remaining}`);

await c.end();
