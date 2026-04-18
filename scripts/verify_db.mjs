#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// 1. Tables exist
const tables = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name;
`);
console.log("Tables in public:");
for (const r of tables.rows) console.log("  -", r.table_name);

// 2. Superadmin seeded
const admin = await client.query(`SELECT id, email, role, active FROM users WHERE role='superadmin'`);
console.log("\nSuperadmin rows:", admin.rows);

// 3. Key tables row counts
for (const t of ["users","teachers","students","classes","class_participants",
                 "chats","payments","notifications","recordings","homework_assignments",
                 "certificates","materials","teacher_student_notes"]) {
  try {
    const r = await client.query(`SELECT count(*)::int FROM ${t}`);
    console.log(`  ${t.padEnd(25)} rows=${r.rows[0].count}`);
  } catch (e) { console.log(`  ${t.padEnd(25)} ERR: ${e.message}`); }
}

// 4. Storage buckets
const buckets = await client.query(`SELECT id, name, public, file_size_limit FROM storage.buckets ORDER BY id`);
console.log("\nStorage buckets:");
for (const b of buckets.rows) console.log("  -", b.id, "public=" + b.public, "limit=" + b.file_size_limit);

await client.end();
