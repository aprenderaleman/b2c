#!/usr/bin/env node
/**
 * Read-only inspection of the legacy MySQL database.
 * Goal: list active students + teachers and inventory the schema so we can
 * plan the migration script afterwards.
 */
import mysql from "mysql2/promise";

const cfg = {
  host:     "62.146.225.25",
  port:     3307,
  user:     "aprenderaleman",
  password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
  connectTimeout: 20_000,
};

const db = await mysql.createConnection(cfg);
console.log("✓ connected to legacy DB\n");

// 1. List every table + row count
const [tables] = await db.query(`SHOW TABLES`);
const tableKey = Object.keys(tables[0])[0];
const names   = tables.map(r => r[tableKey]);

console.log(`Tables (${names.length}):`);
for (const t of names) {
  try {
    const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(`  ${t.padEnd(40)} ${String(c.n).padStart(8)} rows`);
  } catch (e) {
    console.log(`  ${t.padEnd(40)} (err: ${e.code})`);
  }
}

// 2. Find tables that look like users / teachers / students
const candidate = names.filter(n =>
  /user|student|teacher|alumn|profe|estudia/i.test(n)
);
console.log("\nCandidate tables for users/teachers/students:", candidate);

for (const t of candidate) {
  console.log(`\n── ${t} — columns ──`);
  const [cols] = await db.query(`SHOW COLUMNS FROM \`${t}\``);
  for (const c of cols) {
    console.log(`  ${c.Field.padEnd(28)} ${String(c.Type).padEnd(20)} ${c.Null === "YES" ? "null" : "not-null"}  ${c.Key || ""}  default=${c.Default ?? ""}`);
  }
  const [sample] = await db.query(`SELECT * FROM \`${t}\` LIMIT 2`);
  console.log("  sample:", JSON.stringify(sample, null, 2).slice(0, 1500));
}

await db.end();
