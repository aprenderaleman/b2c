// Aplica una migración SQL a la BD de producción. Desde la raíz del proyecto:
//   node scripts/apply_migration.mjs db/migrations/149_student_inactivity_emails.sql
import fs from "node:fs";
import { createRequire } from "node:module";
const file = process.argv[2];
if (!file) { console.error("uso: node scripts/apply_migration.mjs db/migrations/NNN_x.sql"); process.exit(1); }
const pg = createRequire(process.cwd() + "/web/package.json")("pg");
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (!m) continue;
  let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(fs.readFileSync(file, "utf8"));
console.log("OK:", file);
await c.end();
