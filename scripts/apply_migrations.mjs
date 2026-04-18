#!/usr/bin/env node
/**
 * Apply every SQL file in db/migrations/ in lexical order, skipping the
 * legacy 001-003 (already applied by hand earlier).
 *
 * For 004_users_roles.sql we substitute the REPLACE_WITH_* placeholders
 * with ADMIN_EMAIL / ADMIN_PASSWORD_HASH from .env.
 *
 * Usage:
 *   node scripts/apply_migrations.mjs              # apply 004..
 *   node scripts/apply_migrations.mjs --only 017   # apply one
 *
 * Requires pg to be installed (npm install pg) and DATABASE_URL in .env.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");
const migrationsDir = path.join(repoRoot, "db", "migrations");

// Load .env manually (we're outside of Next.js' runtime).
const envPath = path.join(repoRoot, ".env");
if (!fs.existsSync(envPath)) {
  console.error(".env not found at repo root");
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL missing"); process.exit(1); }

const onlyArg = process.argv.indexOf("--only");
const onlyN   = onlyArg >= 0 ? process.argv[onlyArg + 1] : null;

const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith(".sql"))
  .sort()
  .filter(f => {
    const num = Number(f.slice(0, 3));
    if (onlyN) return String(num).padStart(3, "0") === String(onlyN).padStart(3, "0");
    return num >= 4;                   // skip 001-003
  });

if (files.length === 0) {
  console.log("Nothing to apply.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log("connected to", DATABASE_URL.replace(/:[^:@]+@/, ":<redacted>@"));

  for (const f of files) {
    const fullPath = path.join(migrationsDir, f);
    let sql = fs.readFileSync(fullPath, "utf8");

    // Placeholder substitution for 004
    if (f === "004_users_roles.sql") {
      const email = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
      const hash  = env.ADMIN_PASSWORD_HASH ?? "";
      if (!email || !hash) {
        console.error("ADMIN_EMAIL / ADMIN_PASSWORD_HASH missing in .env — cannot seed superadmin");
        process.exit(1);
      }
      sql = sql
        .replace(/REPLACE_WITH_ADMIN_EMAIL/g, email.replace(/'/g, "''"))
        .replace(/REPLACE_WITH_ADMIN_PASSWORD_HASH/g, hash.replace(/'/g, "''"));
    }

    console.log("\n→ applying", f);
    try {
      await client.query(sql);
      console.log("  ✓ ok");
    } catch (err) {
      console.error("  ✗ failed:", err.message);
      process.exit(1);
    }
  }

  console.log("\nAll done.");
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
