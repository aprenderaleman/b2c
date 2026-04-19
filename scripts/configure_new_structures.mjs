#!/usr/bin/env node
/**
 * Post-023 one-shot configuration:
 *   1) Set teacher rates (grupal / individual in cents)
 *   2) Unify "Deutsch A1 Morgens" + "Deutsch A2 - B1 Morgens" into one group
 *   3) Delete "Deutsch A1.2 Nachmittags" (dead group; Nicolas is already in Morgens)
 *   4) Seed pack_started_at = today for all migrated students so the 6-month
 *      expiry clock starts ticking (Gelfis adjusts per-student afterwards).
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

// -- 1) Teacher rates ---------------------------------------------------------
const RATES = [
  { email: "coyotemoonyoga@gmail.com", group: 1700, individual: 1500 }, // Sabine
  { email: "florian.zormann@gmx.at",   group: 1700, individual: 1500 }, // Florian
  { email: "nicaemila2211@gmail.com",  group: 2000, individual: 1700 }, // Veronica
];

console.log("── setting teacher rates ──");
for (const r of RATES) {
  const res = await db.query(
    `UPDATE teachers
        SET rate_group_cents = $1,
            rate_individual_cents = $2
      WHERE user_id = (SELECT id FROM users WHERE email = $3)`,
    [r.group, r.individual, r.email.toLowerCase()],
  );
  console.log(`  ✓ ${r.email}  → group=${r.group/100}€/h  individual=${r.individual/100}€/h  (${res.rowCount} rows)`);
}

// -- 2) Unify Morgens groups -------------------------------------------------
// Keep "Deutsch A1 Morgens" (rename + repoint), delete "Deutsch A2 - B1 Morgens".
console.log("\n── unifying Morgens groups ──");

const { rows: morgensRows } = await db.query(
  `SELECT id, name, legacy_id FROM student_groups
    WHERE name IN ('Deutsch A1 Morgens', 'Deutsch A2 - B1 Morgens', 'Deutsch A1 Morgens ', 'Deutsch A2 - B1 Morgens ')
    ORDER BY name`,
);
for (const g of morgensRows) console.log(`  found: ${g.name.trim()}  (id=${g.id})`);

const keep = morgensRows.find(g => g.name.trim().startsWith("Deutsch A1 Morgens"));
const drop = morgensRows.find(g => g.name.trim().startsWith("Deutsch A2 - B1 Morgens"));

if (!keep || !drop) {
  console.error("✗ Could not find both Morgens groups to merge. Aborting.");
  await db.query("ROLLBACK");
  process.exit(1);
}

// Copy any members in `drop` that aren't already in `keep`
await db.query(
  `INSERT INTO student_group_members (group_id, student_id)
   SELECT $1, student_id FROM student_group_members WHERE group_id = $2
   ON CONFLICT DO NOTHING`,
  [keep.id, drop.id],
);

// Rename + point to the unified Zoom link (the real recurring meeting)
await db.query(
  `UPDATE student_groups
      SET name       = 'Deutsch A1 – B1 Morgens',
          level      = NULL,
          meet_link  = 'https://us06web.zoom.us/j/81635585039?pwd=XmBCQQnH1zPon4NCxAtqwgwKIVbxCH.1',
          legacy_id  = $2   -- rebind to the Zoom recurring meeting id
    WHERE id = $1`,
  [keep.id, "81635585039"],
);

// Delete the other
await db.query(`DELETE FROM student_groups WHERE id = $1`, [drop.id]);
console.log(`  ✓ kept ${keep.id} as "Deutsch A1 – B1 Morgens", deleted ${drop.id}`);

// -- 3) Delete Nachmittags ---------------------------------------------------
console.log("\n── deleting Nachmittags ──");
const { rowCount: delN } = await db.query(
  `DELETE FROM student_groups WHERE name ILIKE 'Deutsch A1.2 Nachmittags%'`,
);
console.log(`  ✓ ${delN} group(s) deleted`);

// -- 4) Seed pack_started_at -------------------------------------------------
console.log("\n── seeding pack_started_at = today for migrated students ──");
const TODAY = new Date().toISOString().slice(0,10);
const { rowCount: seedN } = await db.query(
  `UPDATE students
      SET pack_started_at = $1,
          pack_expires_at = ($1::date + INTERVAL '6 months')::date
    WHERE pack_started_at IS NULL`,
  [TODAY],
);
console.log(`  ✓ ${seedN} student pack dates seeded (expiry = today + 6 months)`);

await db.query("COMMIT");

// -- Verification
console.log("\n=== verification ===");
const { rows: teachers } = await db.query(`
  SELECT u.full_name, u.email, t.rate_group_cents, t.rate_individual_cents
    FROM teachers t JOIN users u ON u.id = t.user_id ORDER BY u.full_name`);
for (const t of teachers) {
  console.log(`  ${t.full_name.padEnd(20)} group=${t.rate_group_cents/100}€/h  individual=${t.rate_individual_cents/100}€/h`);
}

const { rows: groups } = await db.query(`
  SELECT sg.name,
         (SELECT COUNT(*) FROM student_group_members m WHERE m.group_id = sg.id) AS members
    FROM student_groups sg ORDER BY sg.name`);
console.log("\nGroups now:");
for (const g of groups) console.log(`  • ${g.name}  (${g.members} members)`);

const { rows: packs } = await db.query(`
  SELECT full_name, email, classes_purchased, classes_consumed, classes_remaining,
         pack_started_at, pack_expires_at
    FROM v_student_packs ORDER BY full_name`);
console.log("\nStudent packs (via v_student_packs):");
for (const p of packs) {
  console.log(`  • ${p.full_name.padEnd(24)} ${p.classes_consumed}/${p.classes_purchased} consumed  ` +
              `remaining=${p.classes_remaining}  expires=${p.pack_expires_at}`);
}

await db.end();
