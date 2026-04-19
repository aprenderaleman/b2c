#!/usr/bin/env node
/** Read-back from Supabase to confirm the migration landed clean. */
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

const { rows: teachers } = await db.query(`
  SELECT u.full_name, u.email, u.phone,
         t.payment_method, LENGTH(u.password_hash) AS hash_len
    FROM users u JOIN teachers t ON t.user_id = u.id
   WHERE u.role = 'teacher' ORDER BY u.full_name
`);
console.log("\n=== TEACHERS ===");
for (const t of teachers) {
  console.log(`• ${t.full_name.padEnd(22)} ${t.email.padEnd(34)} bcrypt=${t.hash_len}ch`);
  if (t.payment_method) console.log(`    pago: ${t.payment_method}`);
}

const { rows: students } = await db.query(`
  SELECT u.full_name, u.email, u.phone,
         s.current_level, s.subscription_type, s.subscription_status,
         s.monthly_price_cents, s.notes, LENGTH(u.password_hash) AS hash_len
    FROM users u JOIN students s ON s.user_id = u.id
   WHERE u.role = 'student' ORDER BY u.full_name
`);
console.log(`\n=== STUDENTS (${students.length}) ===`);
for (const s of students) {
  const price = s.monthly_price_cents ? `€${(s.monthly_price_cents/100).toFixed(0)}/mes` : "";
  console.log(`• ${s.full_name.padEnd(24)} ${s.email.padEnd(34)} ${s.current_level} ${s.subscription_status} ${price}`);
  console.log(`    phone: ${s.phone ?? "—"}   bcrypt=${s.hash_len}ch`);
  if (s.notes) console.log(`    notas: ${s.notes.slice(0,130)}`);
}

const { rows: groups } = await db.query(`
  SELECT sg.name, sg.class_type, sg.level, sg.active,
         (SELECT COUNT(*) FROM student_group_members m WHERE m.group_id = sg.id) AS members,
         COALESCE(ut.full_name, '— (teacher NULL)') AS teacher
    FROM student_groups sg
    LEFT JOIN teachers t ON t.id = sg.teacher_id
    LEFT JOIN users    ut ON ut.id = t.user_id
   ORDER BY sg.name
`);
console.log(`\n=== GROUPS (${groups.length}) ===`);
for (const g of groups) {
  console.log(`• [${g.class_type}] ${g.name.padEnd(52)} lvl=${(g.level ?? "—").padEnd(4)} members=${g.members}  teacher=${g.teacher}`);
}

await db.end();
