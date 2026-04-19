#!/usr/bin/env node
/**
 * Re-sync student_groups.document_url from the legacy MySQL DB so every
 * group we migrated has its Google Docs link. `legacy_id` on our groups
 * points back to the legacy row, so the join is trivial. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg    = require("pg");
const mysql = require("mysql2/promise");

const __d = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__d, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const legacy = await mysql.createConnection({
  host: "62.146.225.25", port: 3307,
  user: "aprenderaleman", password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
});
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

// 1) What's the current state?
const { rows: before } = await db.query(`
  SELECT id, name, legacy_id, meet_link, document_url
    FROM student_groups
   ORDER BY name`);
console.log("BEFORE:");
for (const g of before) {
  console.log(`  ${g.name.padEnd(50)} doc=${g.document_url ? "✓" : "—"}  legacy_id=${g.legacy_id ?? "—"}`);
}

// 2) Pull legacy doc urls — keyed by legacy student_groups.id (which is
//    what we stored into our student_groups.legacy_id at migration time)
//    AND by Zoom meeting id (Morgens unified uses the Zoom id as legacy_id).
const legacyIds = before.map(g => g.legacy_id).filter(Boolean);
const [legacyRows] = await legacy.query(
  `SELECT id, name, documentUrl, meetLink FROM student_groups
    WHERE id IN (${legacyIds.map(() => "?").join(",") || "NULL"})
       OR id IN (
         -- Morgens was unified; if our legacy_id is a Zoom meeting id,
         -- match by NAME containing "Morgens" as a fallback.
         SELECT id FROM student_groups WHERE name LIKE '%Morgens%'
       )`,
  legacyIds,
);
const legacyById = new Map(legacyRows.map(r => [r.id, r]));

// For Morgens (unified, legacy_id = Zoom meeting id not a Prisma uuid),
// pick the most recent "Morgens" legacy row that has a documentUrl.
const morgensLegacy = legacyRows
  .filter(r => /morgens/i.test(r.name) && r.documentUrl)
  .sort((a, b) => (b.name ?? "").localeCompare(a.name ?? ""))[0];

// 3) Update each of our groups
console.log("\nUPDATES:");
let updated = 0;
for (const g of before) {
  let docUrl = null;

  if (g.legacy_id && legacyById.has(g.legacy_id)) {
    docUrl = legacyById.get(g.legacy_id).documentUrl ?? null;
  }

  // Special case: unified Morgens group whose legacy_id is the Zoom id
  if (!docUrl && /morgens/i.test(g.name) && morgensLegacy) {
    docUrl = morgensLegacy.documentUrl;
  }

  if (!docUrl) {
    console.log(`  — ${g.name.padEnd(50)} (legacy tiene documentUrl vacío)`);
    continue;
  }
  if (g.document_url === docUrl) {
    console.log(`  = ${g.name.padEnd(50)} (ya estaba igual)`);
    continue;
  }

  await db.query(`UPDATE student_groups SET document_url = $1 WHERE id = $2`, [docUrl, g.id]);
  console.log(`  ✓ ${g.name.padEnd(50)} → ${docUrl.slice(0, 80)}`);
  updated++;
}

console.log(`\n${updated} grupo(s) actualizado(s).`);

// Final read-back
const { rows: after } = await db.query(`
  SELECT name, document_url FROM student_groups ORDER BY name`);
console.log("\nAFTER:");
for (const g of after) {
  console.log(`  ${g.name.padEnd(50)} doc=${g.document_url ? "✓" : "—"}`);
}

await legacy.end();
await db.end();
