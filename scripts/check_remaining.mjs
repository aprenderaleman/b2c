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
const { rows } = await db.query(`
  SELECT u.full_name, s.classes_purchased, s.classes_remaining,
         (s.classes_purchased - s.classes_remaining) AS consumed
    FROM students s JOIN users u ON u.id = s.user_id
   ORDER BY s.classes_remaining ASC`);
console.log("students.classes_remaining (synced by trigger):");
for (const r of rows) {
  console.log(`  ${r.full_name.padEnd(24)} purchased=${r.classes_purchased}  consumed=${r.consumed}  remaining=${r.classes_remaining}`);
}
await db.end();
