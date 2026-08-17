#!/usr/bin/env node
/**
 * Investigación forense de Alejandro: por qué la DB dice
 * classes_purchased=96, classes_remaining=34 cuando el dueño dice
 * que compró 84 y no ha consumido 62.
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

// 1. Buscar TODOS los registros con nombre Alejandro o email "alejo"
console.log("══════════ 1. CANDIDATOS (nombre o email tipo 'alejo') ══════════");
const { rows: candidates } = await db.query(`
  SELECT u.id AS user_id, u.email, u.full_name, u.role, u.created_at,
         s.id AS student_id, s.classes_purchased, s.classes_remaining,
         s.pack_started_at, s.subscription_status
    FROM users u
    LEFT JOIN students s ON s.user_id = u.id
   WHERE u.full_name ILIKE '%alejandro%'
      OR LOWER(u.email) LIKE '%alej%'
      OR LOWER(u.email) LIKE '%alejo%'
   ORDER BY u.full_name, u.email`);
for (const c of candidates) {
  console.log(`  user=${c.user_id}`);
  console.log(`    full_name=${c.full_name}  email=${c.email}  role=${c.role}`);
  console.log(`    student_id=${c.student_id ?? "—"}  purchased=${c.classes_purchased ?? "—"}  remaining=${c.classes_remaining ?? "—"}  pack_started=${c.pack_started_at?.toISOString?.()?.slice(0,10) ?? "—"}`);
}

// Tomar el que tenga full_name con "Alejandro" para seguir
const a = candidates.find(c => (c.full_name ?? "").toLowerCase().includes("alejandro") && c.role === "student");
if (!a) {
  console.log("\n  ✗ No hay student con full_name='Alejandro'");
  await db.end(); process.exit(0);
}
console.log(`\n  → Sigo con: ${a.full_name}  student_id=${a.student_id}\n`);
a.id = a.student_id;
// 2. Pagos
console.log("\n══════════ 2. PAYMENTS de Alejandro ══════════");
const { rows: pays } = await db.query(`
  SELECT id, amount_cents, currency, type, status, classes_added, note, paid_at, created_at
    FROM payments
   WHERE student_id = $1
   ORDER BY created_at`, [a.id]);
if (pays.length === 0) console.log("  (sin pagos en payments)");
let totalClasses = 0, totalEur = 0;
for (const p of pays) {
  console.log(`  ${p.created_at.toISOString().slice(0,10)}  ${p.type.padEnd(20)}  ${(p.amount_cents/100).toFixed(2)} ${p.currency}  +${p.classes_added} clases  ${p.status}  "${p.note ?? ""}"`);
  totalClasses += p.classes_added;
  if (p.status === "paid") totalEur += p.amount_cents;
}
console.log(`  ─────────────  ${pays.length} pagos · ${totalClasses} clases compradas · ${(totalEur/100).toFixed(2)} EUR pagado`);

// 3. Participaciones (TODAS, no solo abril)
console.log("\n══════════ 3. CLASS_PARTICIPANTS de Alejandro ══════════");
const { rows: parts } = await db.query(`
  SELECT cp.attended, cp.counts_as_session, cp.minutes_attended,
         c.id AS class_id, c.scheduled_at, c.started_at, c.duration_minutes,
         c.actual_duration_minutes, c.billed_hours, c.status, c.title,
         c.notes_admin
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1
   ORDER BY c.scheduled_at`, [a.id]);
console.log(`  ${parts.length} filas en class_participants`);
for (const p of parts) {
  const date = p.started_at?.toISOString?.()?.slice(0,10) ?? p.scheduled_at?.toISOString?.()?.slice(0,10);
  console.log(`  ${date}  bh=${p.billed_hours}h  status=${p.status}  attended=${p.attended}  counts=${p.counts_as_session}  "${p.title}"`);
}

// 4. ¿Está en algún grupo?
console.log("\n══════════ 4. GRUPOS donde está Alejandro ══════════");
const { rows: groups } = await db.query(`
  SELECT g.id, g.name, g.class_type, g.active,
         (SELECT u2.full_name FROM teachers t LEFT JOIN users u2 ON u2.id = t.user_id WHERE t.id = g.teacher_id) AS teacher_name
    FROM student_group_members m
    JOIN student_groups g ON g.id = m.group_id
   WHERE m.student_id = $1`, [a.id]);
if (groups.length === 0) console.log("  (no es miembro de ningún grupo)");
for (const g of groups) {
  console.log(`  - "${g.name}"  tipo=${g.class_type}  active=${g.active}  profe=${g.teacher_name}`);
}

// 5. ¿El seed_alejandro_classes.mjs creó clases?  Buscar clases con título o notes que apunten a él
console.log("\n══════════ 5. CLASES con notes_admin tipo 'alejandro' o título relacionado ══════════");
const { rows: alejoClasses } = await db.query(`
  SELECT id, title, scheduled_at, status, billed_hours, notes_admin, type
    FROM classes
   WHERE notes_admin ILIKE '%alejandro%' OR notes_admin ILIKE '%alejo%' OR title ILIKE '%alejandro%'
   ORDER BY scheduled_at`);
console.log(`  ${alejoClasses.length} clases relacionadas`);
for (const c of alejoClasses) {
  console.log(`  ${c.scheduled_at?.toISOString?.()?.slice(0,10)}  ${c.type}  bh=${c.billed_hours}  status=${c.status}  "${c.title}"  notes="${c.notes_admin}"`);
}

// 6. Trigger sanity: re-correr el cálculo y ver qué dice
console.log("\n══════════ 6. RE-CALCULO del trigger (sin escribir) ══════════");
const { rows: [calc] } = await db.query(`
  SELECT GREATEST(0,
            $1::int - COALESCE((
                SELECT COUNT(*)::int
                  FROM class_participants cp
                  JOIN classes c ON c.id = cp.class_id
                 WHERE cp.student_id = $2
                   AND cp.counts_as_session = TRUE
                   AND c.status = 'completed'
                   AND c.billed_hours > 0
            ), 0)) AS expected_remaining`, [a.classes_purchased, a.id]);
console.log(`  Cálculo del trigger: classes_remaining DEBERÍA ser ${calc.expected_remaining} (es ${a.classes_remaining})`);
console.log(`  Es decir, según el trigger, le restan ${calc.expected_remaining}/${a.classes_purchased} clases.`);

await db.end();
