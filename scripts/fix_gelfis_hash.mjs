#!/usr/bin/env node
/**
 * Replays migration 004's seed with the properly-unquoted hash from .env,
 * fixing the trailing single-quote artefact left by apply_migrations.mjs.
 */
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
  if (!m) continue;
  let v = m[2];
  // Strip surrounding quotes (either kind) properly.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

const hash = env.ADMIN_PASSWORD_HASH;
const email = env.ADMIN_EMAIL;

if (!hash.startsWith("$2") || hash.length < 55 || hash.length > 62) {
  console.error("Hash looks malformed:", hash);
  process.exit(1);
}

// Verify the hash still validates "H2310994h!" locally before writing.
const sanity = await bcrypt.compare("H2310994h!", hash);
if (!sanity) {
  console.error("Sanity check failed: hash from .env does NOT validate the known password.");
  process.exit(1);
}
console.log("✓ hash validates the expected password locally");

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `UPDATE users SET password_hash = $1, active = TRUE WHERE email = $2
     RETURNING id, email, length(password_hash) AS len`,
  [hash, email],
);
if (rows.length === 0) {
  console.error("No user updated — email not found in users table");
  process.exit(2);
}
console.log("✓ updated row:", rows[0]);

// Re-verify against the DB copy.
const fresh = await client.query(`SELECT password_hash FROM users WHERE email = $1`, [email]);
const dbHash = fresh.rows[0].password_hash;
const works  = await bcrypt.compare("H2310994h!", dbHash);
console.log("bcrypt.compare('H2310994h!', db_hash) →", works ? "✓" : "✗");

await client.end();
