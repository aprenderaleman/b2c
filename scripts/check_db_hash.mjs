#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg     = require("pg");
const bcrypt = require("bcryptjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `SELECT id, email, password_hash, role, active FROM users WHERE email = $1`,
  [env.ADMIN_EMAIL],
);

if (rows.length === 0) {
  console.error("No row for", env.ADMIN_EMAIL);
  process.exit(1);
}
const row = rows[0];
console.log("Row in DB:");
console.log("  id:      ", row.id);
console.log("  email:   ", row.email);
console.log("  role:    ", row.role);
console.log("  active:  ", row.active);
console.log("  hash:    ", row.password_hash);
console.log("  hash len:", row.password_hash.length);
console.log();
console.log(".env hash:  ", env.ADMIN_PASSWORD_HASH);
console.log(".env length:", env.ADMIN_PASSWORD_HASH.length);
console.log();
console.log("same hash?", row.password_hash === env.ADMIN_PASSWORD_HASH);
console.log();
const match = await bcrypt.compare("H2310994h!", row.password_hash);
console.log("bcrypt.compare('H2310994h!', db_hash) →", match);

await client.end();
