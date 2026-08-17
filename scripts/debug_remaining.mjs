#!/usr/bin/env node
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

// Estado actual de Alejandro
const { rows: [a] } = await db.query(`
  SELECT s.id, s.classes_purchased, s.classes_remaining
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.email = 'xela_cigales@hotmail.es'`);
console.log(`Alejandro: id=${a.id}  purchased=${a.classes_purchased}  remaining=${a.classes_remaining}`);

// Cálculo manual del trigger
const { rows: [calc] } = await db.query(`
  SELECT COUNT(*)::int AS cnt
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1
     AND cp.counts_as_session = TRUE
     AND c.status = 'completed'
     AND c.billed_hours > 0`, [a.id]);
console.log(`  Cálculo del trigger: count = ${calc.cnt}`);
console.log(`  → debería ser remaining = ${a.classes_purchased} - ${calc.cnt} = ${a.classes_purchased - calc.cnt}`);

// Detalle: ¿qué participaciones cuentan?
const { rows: parts } = await db.query(`
  SELECT c.id, c.title, c.scheduled_at, c.status, c.billed_hours, cp.counts_as_session
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1
     AND cp.counts_as_session = TRUE
     AND c.status = 'completed'
     AND c.billed_hours > 0
   ORDER BY c.scheduled_at`, [a.id]);
console.log(`\n  Participaciones que CUENTAN:`);
for (const p of parts) {
  console.log(`    ${p.scheduled_at?.toISOString?.()?.slice(0,10)}  bh=${p.billed_hours}  "${p.title}"  id=${p.id}`);
}

// Re-correr el trigger manualmente
console.log(`\n  Ejecutando recompute_classes_remaining...`);
await db.query(`SELECT recompute_classes_remaining($1)`, [a.id]);
const { rows: [aAfter] } = await db.query(`SELECT classes_remaining FROM students WHERE id = $1`, [a.id]);
console.log(`  classes_remaining DESPUÉS de recompute: ${aAfter.classes_remaining}`);

await db.end();
