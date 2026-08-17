#!/usr/bin/env node
/**
 * Follow-up: limpiar el classes_adjustment fantasma de Alejandro.
 * Estaba en -62 (legacy ficticio según Gelfis). Lo ponemos en 0.
 * Después: 84 (purchased) + 0 (adjustment) - 1 (participación real) = 83 restantes.
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
await db.query("BEGIN");

try {
  const { rows: [a] } = await db.query(`
    SELECT s.id, s.classes_purchased, s.classes_adjustment, s.classes_remaining
      FROM students s JOIN users u ON u.id = s.user_id
     WHERE u.email = 'xela_cigales@hotmail.es'`);
  if (!a) throw new Error("Alejandro no encontrado");
  console.log(`Alejandro ANTES: purchased=${a.classes_purchased}  adjustment=${a.classes_adjustment}  remaining=${a.classes_remaining}`);

  await db.query(`UPDATE students SET classes_adjustment = 0 WHERE id = $1`, [a.id]);
  await db.query(`SELECT recompute_classes_remaining($1)`, [a.id]);

  const { rows: [b] } = await db.query(`
    SELECT classes_purchased, classes_adjustment, classes_remaining FROM students WHERE id = $1`, [a.id]);
  console.log(`Alejandro DESPUÉS: purchased=${b.classes_purchased}  adjustment=${b.classes_adjustment}  remaining=${b.classes_remaining}`);

  await db.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await db.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  await db.end();
  process.exit(1);
}

await db.end();
