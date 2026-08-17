// Mira el drop-off paso 1 → paso 5, y desglose UTM si existe.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

// Estructura de lead_motivo_inicial
console.log("=== Columnas lead_motivo_inicial ===");
const cols = await db.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='lead_motivo_inicial' ORDER BY ordinal_position
`);
for (const c of cols.rows) console.log(`  ${c.column_name} (${c.data_type})`);

// Drop-off por día
console.log("\n=== DROP-OFF paso 1 → paso 5 por día (14d) ===");
const dropoff = await db.query(`
  SELECT date(m.created_at) AS d,
         count(*) AS step1_sessions,
         count(m.lead_id) AS llegaron_paso5,
         round(100.0*count(m.lead_id)/count(*),1) AS conv_pct
  FROM lead_motivo_inicial m
  WHERE m.created_at >= now() - interval '14 days'
  GROUP BY 1 ORDER BY 1
`);
for (const r of dropoff.rows) {
  console.log(`  ${r.d.toISOString().slice(0,10)}: ${String(r.step1_sessions).padStart(3)} sesiones → ${String(r.llegaron_paso5).padStart(2)} leads (${r.conv_pct}%)`);
}

// Por motivo (qué motivo convierte mejor)
console.log("\n=== Conversión por motivo (14d) ===");
const byMotivo = await db.query(`
  SELECT motivo, count(*) AS sessions, count(lead_id) AS converted,
         round(100.0*count(lead_id)/count(*),1) AS pct
  FROM lead_motivo_inicial
  WHERE created_at >= now() - interval '14 days'
  GROUP BY motivo ORDER BY sessions DESC
`);
for (const r of byMotivo.rows) {
  console.log(`  ${(r.motivo ?? "?").padEnd(14)}: ${String(r.sessions).padStart(3)} → ${String(r.converted).padStart(2)} (${r.pct}%)`);
}

// Sesiones por hora hoy
console.log("\n=== Sesiones HOY por hora (Berlin) ===");
const today = await db.query(`
  SELECT to_char(created_at at time zone 'Europe/Berlin', 'HH24:00') AS h, count(*)
  FROM lead_motivo_inicial
  WHERE created_at >= date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'
  GROUP BY 1 ORDER BY 1
`);
for (const r of today.rows) console.log(`  ${r.h}: ${r.count}`);

// Última sesión de cada motivo
console.log("\n=== Última sesión registrada (por motivo) ===");
const last = await db.query(`
  SELECT motivo, max(created_at) AS last_at
  FROM lead_motivo_inicial GROUP BY motivo ORDER BY last_at DESC
`);
for (const r of last.rows) {
  const h = ((Date.now() - new Date(r.last_at).getTime())/3600_000).toFixed(1);
  console.log(`  ${(r.motivo ?? "?").padEnd(14)}: hace ${h}h (${r.last_at.toISOString().slice(0,16).replace("T"," ")})`);
}

// Errores recientes del endpoint — buscamos timeline notes con errores
console.log("\n=== Validación: % de sesiones sin lead vinculado por día (14d) ===");
console.log("(Si una sesión inicia pero nadie completa el paso 5, lead_id queda NULL)");

await db.end();
