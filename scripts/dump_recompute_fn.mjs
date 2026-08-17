#!/usr/bin/env node
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
  SELECT proname, pg_get_functiondef(oid) AS def
    FROM pg_proc
   WHERE proname IN ('recompute_classes_remaining','tg_classes_sync_remaining','tg_cp_sync_remaining')
   ORDER BY proname`);
for (const r of rows) {
  console.log(`──── ${r.proname} ────`);
  console.log(r.def);
  console.log();
}

await db.end();
