#!/usr/bin/env node
/**
 * Create a short throwaway class for the current admin to test the
 * LiveKit recording flow end-to-end. Runs the class in the next 2 min,
 * lasting 15 min. Gelfis (admin) is both creator AND attendee — we
 * pick ANY teacher and attach Gelfis's student fake-id (admin can't
 * be a student, so we'll register as participant by impersonating).
 *
 * Output: the class id + URL so Gelfis can click to enter.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __d = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__d, ".."), ".env");
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

// Pick any active teacher
const { rows: teachers } = await db.query(`
  SELECT t.id AS teacher_id, u.full_name, u.email
    FROM teachers t JOIN users u ON u.id = t.user_id
   WHERE u.active = TRUE LIMIT 1`);
if (teachers.length === 0) { console.error("No active teacher."); process.exit(1); }
const teacher = teachers[0];

// Pick any student for the participant row (Gelfis can impersonate him
// from another tab / mobile to have a 2nd participant — optional).
const { rows: students } = await db.query(`
  SELECT s.id AS student_id, u.full_name, u.email, u.id AS user_id
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.active = TRUE
   ORDER BY u.full_name LIMIT 1`);
if (students.length === 0) { console.error("No active student."); process.exit(1); }
const student = students[0];

const scheduledAt = new Date(Date.now() + 2 * 60 * 1000);   // in 2 min
const duration = 15;

const { rows: [cls] } = await db.query(`
  INSERT INTO classes (type, teacher_id, scheduled_at, duration_minutes,
                       title, topic, status, notes_admin)
  VALUES ('individual', $1, $2, $3,
          'PRUEBA · Grabación LiveKit (borrable)',
          'Smoke test — se puede borrar esta clase después',
          'scheduled', 'test_recording_smoke')
  RETURNING id, livekit_room_id`,
  [teacher.teacher_id, scheduledAt, duration]);

await db.query(
  `INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
   VALUES ($1, $2, NULL, FALSE)`,
  [cls.id, student.student_id]);

console.log(`\n═══ Clase de prueba creada ═══`);
console.log(`  ID:            ${cls.id}`);
console.log(`  Hora:          ${scheduledAt.toLocaleString("es-ES", { timeZone: "Europe/Berlin" })} (Berlín)`);
console.log(`  Duración:      ${duration} min`);
console.log(`  Profesor:      ${teacher.full_name} <${teacher.email}>`);
console.log(`  Estudiante:    ${student.full_name} <${student.email}>`);
console.log(`  livekit_room:  ${cls.livekit_room_id}`);
console.log(``);
console.log(`  👉 Entra como PROFESOR aquí:`);
console.log(`     https://b2c.aprender-aleman.de/admin/estudiantes/${student.student_id}`);
console.log(`     → botón "Ver como ${teacher.full_name.split(" ")[0]}" NO — necesitas impersonar al profe desde:`);
console.log(`     https://b2c.aprender-aleman.de/admin/profesores → clic en ${teacher.full_name} → "Ver como" → /profesor → entra al aula`);
console.log(``);
console.log(`  O directo (como profe): https://b2c.aprender-aleman.de/aula/${cls.id}`);
console.log(``);
console.log(`  Para borrar después:`);
console.log(`     DELETE FROM classes WHERE id = '${cls.id}';`);
await db.end();
