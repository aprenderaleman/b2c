// Aplica db/migrations/148_chat_email_notices.sql. Ejecutar desde la raíz:  node scripts/apply_148.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/web/package.json");
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (!m) continue;
  let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(fs.readFileSync("db/migrations/148_chat_email_notices.sql", "utf8"));
const r = await c.query("SELECT to_regclass('public.chat_email_notices') AS t");
console.log("148 OK, tabla:", r.rows[0].t);
await c.end();
