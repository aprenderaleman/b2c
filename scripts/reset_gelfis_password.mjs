#!/usr/bin/env node
/**
 * Reset the password of the superadmin (Gelfis) by updating the bcrypt
 * hash directly in the `users` table. Use this if the password stored
 * when the migration was seeded no longer matches what you remember.
 *
 * Usage:
 *   NEW_PASSWORD="MyNewPass123!" node scripts/reset_gelfis_password.mjs
 *
 * Or pass the email explicitly:
 *   USER_EMAIL=other@example.com NEW_PASSWORD=xxx node scripts/reset_gelfis_password.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg     = require("pg");
const bcrypt = require("bcryptjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");
const envPath   = path.join(repoRoot, ".env");

const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

const email   = (process.env.USER_EMAIL   ?? env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const newPass = process.env.NEW_PASSWORD;

if (!newPass) {
  console.error("NEW_PASSWORD env var is required.");
  console.error("Example: NEW_PASSWORD='MyNewSecret!' node scripts/reset_gelfis_password.mjs");
  process.exit(1);
}
if (newPass.length < 8) {
  console.error("Password must be ≥ 8 characters.");
  process.exit(1);
}
if (!email) {
  console.error("USER_EMAIL or ADMIN_EMAIL in .env must be set.");
  process.exit(1);
}

const hash = await bcrypt.hash(newPass, 12);

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `UPDATE users
      SET password_hash = $1,
          must_change_password = FALSE,
          active = TRUE
    WHERE email = $2
    RETURNING id, email, role`,
  [hash, email],
);
if (rows.length === 0) {
  console.error(`No user found with email=${email}`);
  process.exit(2);
}
console.log(`✓ password reset for ${rows[0].email} (role=${rows[0].role}, id=${rows[0].id})`);
console.log(`  you can now log in at https://b2c.aprender-aleman.de/login`);

await client.end();
