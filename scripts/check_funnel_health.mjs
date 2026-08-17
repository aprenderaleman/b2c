// Auditoría rápida del funnel — últimos 14 días.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }),
);

const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

console.log("\n=== LEADS últimos 14 días ===");
const r1 = await db.query(`
  SELECT date(created_at) AS d, count(*)
  FROM leads
  WHERE created_at >= now() - interval '14 days'
  GROUP BY 1 ORDER BY 1
`);
console.log("Por día:");
for (const row of r1.rows) console.log(`  ${row.d.toISOString().slice(0,10)}: ${row.count}`);
const totalLeads = r1.rows.reduce((a,r)=>a + Number(r.count), 0);
console.log(`  TOTAL: ${totalLeads}`);

const r2 = await db.query(`
  SELECT coalesce(source,'(null)') AS source, count(*)
  FROM leads
  WHERE created_at >= now() - interval '14 days'
  GROUP BY 1 ORDER BY 2 DESC
`);
console.log("\nPor source:");
for (const row of r2.rows) console.log(`  ${row.source.padEnd(20)}: ${row.count}`);

const r3 = await db.query(`
  SELECT status, count(*)
  FROM leads
  WHERE created_at >= now() - interval '14 days'
  GROUP BY 1 ORDER BY 2 DESC
`);
console.log("\nPor status:");
for (const row of r3.rows) console.log(`  ${row.status.padEnd(20)}: ${row.count}`);

console.log("\n=== ÚLTIMOS 10 LEADS ===");
const r4 = await db.query(`
  SELECT created_at, coalesce(source,'?') AS source, status, country, coalesce(name, email, '?') AS who
  FROM leads
  ORDER BY created_at DESC LIMIT 10
`);
for (const row of r4.rows) {
  const ts = row.created_at.toISOString().slice(0,16).replace("T"," ");
  console.log(`  ${ts} · ${row.source.padEnd(14)} · ${row.status.padEnd(18)} · ${row.country ?? "??"} · ${row.who}`);
}

console.log("\n=== ÚLTIMO LEAD VÍA /diagnostico ===");
const r5 = await db.query(`
  SELECT created_at, name, status, country, language, motivo_inicial
  FROM leads WHERE source = 'diagnostico'
  ORDER BY created_at DESC LIMIT 1
`);
if (r5.rows.length) {
  const l = r5.rows[0];
  const hoursAgo = ((Date.now() - new Date(l.created_at).getTime()) / 3600_000).toFixed(1);
  console.log(`  ${l.created_at.toISOString()} (hace ${hoursAgo}h)`);
  console.log(`  ${l.name} · ${l.status} · ${l.country}/${l.language} · motivo=${l.motivo_inicial}`);
} else {
  console.log("  ⚠️  NINGUNO REGISTRADO POR EL FUNNEL.");
}

console.log("\n=== PASO 1 (motivo_inicial — sesiones funnel iniciadas) ===");
const r6 = await db.query(`
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '14 days') AS total_14d,
         count(*) FILTER (WHERE created_at >= now() - interval '14 days' AND lead_id IS NOT NULL) AS completaron_paso5,
         count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS total_7d,
         count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS total_24h,
         max(created_at) AS last_session
  FROM lead_motivo_inicial
`);
const m = r6.rows[0];
console.log(`  Sesiones iniciadas últimas 24h: ${m.total_24h}`);
console.log(`  Sesiones iniciadas últimos 7d:  ${m.total_7d}`);
console.log(`  Sesiones iniciadas últimos 14d: ${m.total_14d}`);
console.log(`  De esos 14d, completaron hasta paso 5: ${m.completaron_paso5}`);
if (m.last_session) {
  const hoursAgo = ((Date.now() - new Date(m.last_session).getTime()) / 3600_000).toFixed(1);
  console.log(`  Última sesión: ${m.last_session.toISOString()} (hace ${hoursAgo}h)`);
}

await db.end();
