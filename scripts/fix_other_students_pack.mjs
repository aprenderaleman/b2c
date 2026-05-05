// Limpieza de los 6 alumnos restantes afectados por el bug de backfill
// Zoom del 2026-04-19. Aplica:
//   1) DELETE 3 filas fantasma legítimas en class_participants
//      (Javier 8-feb, Victoria 8-feb, Francisco 20-abr).
//   2) UPDATE classes_purchased + classes_adjustment=0 según el plan real.
//   3) UPDATE billed_hours de 2 clases LiveKit que quedaron en 0
//      (4-30 Abends → 1 ; 5-4 Abends → 2).
// Todo en una sola transacción.

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

const PLANS = [
  { email: "javiesqueta2203@gmail.com",        plan: 64 },
  { email: "victoriaavilesgonzalez@gmail.com", plan: 84 },
  { email: "mariupp2016@gmail.com",            plan: 64 },
  { email: "ayman.kayali.lucena@gmail.com",    plan: 64 },
  { email: "viverosluisemilio@gmail.com",      plan: 84 },
  { email: "catalan_640@hotmail.com",          plan: 16 },
];

// Resolver student_id de cada
const ids = {};
for (const p of PLANS) {
  const r = await c.query(`
    SELECT s.id, u.full_name, s.classes_purchased, s.classes_adjustment
      FROM students s JOIN users u ON u.id=s.user_id WHERE u.email=$1`, [p.email]);
  if (r.rows.length === 0) throw new Error(`no encontrado: ${p.email}`);
  ids[p.email] = r.rows[0];
  console.log(`  ${r.rows[0].full_name.padEnd(20)} | id=${r.rows[0].id.slice(0,8)} | plan actual=${r.rows[0].classes_purchased}+${r.rows[0].classes_adjustment} → nuevo=${p.plan}+0`);
}
console.log("");

// Identificar las filas fantasma a borrar
console.log("══════════ Filas fantasma a borrar ══════════");
const phantomQueries = [
  // Javier - Feb 8 Morgens
  { email: "javiesqueta2203@gmail.com",
    where: `c.title ILIKE '%A1 – B1 Morgens%' AND c.scheduled_at::date = '2026-02-08'` },
  // Victoria - Feb 8 Morgens
  { email: "victoriaavilesgonzalez@gmail.com",
    where: `c.title ILIKE '%A1 – B1 Morgens%' AND c.scheduled_at::date = '2026-02-08'` },
  // Francisco - Apr 20 Abends Zoom
  { email: "catalan_640@hotmail.com",
    where: `c.title ILIKE '%Abends%' AND c.scheduled_at::date = '2026-04-20' AND c.notes_admin LIKE 'zoom_uuid=%'` },
];

const toDelete = [];
for (const pq of phantomQueries) {
  const r = await c.query(`
    SELECT cp.class_id, c.scheduled_at, c.title, c.billed_hours
      FROM class_participants cp JOIN classes c ON c.id=cp.class_id
      JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id
     WHERE u.email = $1 AND ${pq.where}`, [pq.email]);
  for (const row of r.rows) {
    toDelete.push({ email: pq.email, ...row });
    console.log(`  · ${pq.email.padEnd(36)} ${row.scheduled_at.toISOString().slice(0,16)}  bill=${row.billed_hours}  ${row.title?.slice(0,30)}`);
  }
}
console.log("");

// Identificar las clases LiveKit a billing
console.log("══════════ Clases LiveKit a actualizar bill ══════════");
const billUpdates = [];
for (const cfg of [
  { date: "2026-04-30", time: "17:00", bill: 1 },
  { date: "2026-05-04", time: "17:00", bill: 2 },
]) {
  const r = await c.query(`
    SELECT id, scheduled_at, title, billed_hours, ended_at, status
      FROM classes
     WHERE title ILIKE '%Abends%'
       AND scheduled_at = $1::timestamptz`,
    [`${cfg.date} ${cfg.time}:00+00`]);
  for (const row of r.rows) {
    billUpdates.push({ ...row, newBill: cfg.bill });
    console.log(`  · ${row.scheduled_at.toISOString().slice(0,16)} | ${row.title?.slice(0,30)} | bill ${row.billed_hours} → ${cfg.bill} | status=${row.status}`);
  }
}
console.log("");

if (DRY) { await c.end(); process.exit(0); }

await c.query("BEGIN");
try {
  // 1) Borrar fantasmas
  let deleted = 0;
  for (const d of toDelete) {
    const stuId = ids[d.email].id;
    const r = await c.query(`DELETE FROM class_participants WHERE student_id=$1 AND class_id=$2`, [stuId, d.class_id]);
    deleted += r.rowCount;
  }
  console.log(`✓ Borradas ${deleted} filas fantasma`);

  // 2) Actualizar planes
  for (const p of PLANS) {
    const stuId = ids[p.email].id;
    await c.query(`UPDATE students SET classes_purchased=$1, classes_adjustment=0, updated_at=NOW() WHERE id=$2`, [p.plan, stuId]);
  }
  console.log(`✓ Actualizados ${PLANS.length} planes`);

  // 3) Actualizar billed_hours de las 2 clases LiveKit
  for (const u of billUpdates) {
    await c.query(`UPDATE classes SET billed_hours=$1, updated_at=NOW() WHERE id=$2`, [u.newBill, u.id]);
  }
  console.log(`✓ Actualizados ${billUpdates.length} billed_hours`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT\n");
} catch (err) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", err.message);
  process.exit(1);
}

// Verificación final
console.log("══════════ ESTADO FINAL ══════════");
console.log("alumno              | plan | consumed | remaining");
for (const p of PLANS) {
  const r = await c.query(`SELECT classes_purchased, classes_adjustment, classes_consumed, classes_remaining
                             FROM v_student_packs WHERE email=$1`, [p.email]);
  const x = r.rows[0];
  console.log(`${ids[p.email].full_name.padEnd(20)}|${String(x.classes_purchased+x.classes_adjustment).padStart(5)} |${String(x.classes_consumed).padStart(9)} |${String(x.classes_remaining).padStart(10)}`);
}

await c.end();
