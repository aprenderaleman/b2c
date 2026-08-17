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

// 1. Datos del usuario
const { rows: [florian] } = await db.query(`
  SELECT u.id AS user_id, u.email, u.full_name, u.last_login_at, u.created_at,
         t.id AS teacher_id
    FROM users u JOIN teachers t ON t.user_id = u.id
   WHERE u.full_name = 'Florian Zormann'`);
console.log(`Florian: user_id=${florian.user_id}  email=${florian.email}`);
console.log(`  user.created_at:    ${florian.created_at?.toISOString?.()}`);
console.log(`  user.last_login_at: ${florian.last_login_at?.toISOString?.() ?? "NUNCA HA INICIADO SESIÓN"}`);

// 2. ¿Cuántas de sus clases vinieron del aula LiveKit vs Zoom backfill?
const { rows: [counts] } = await db.query(`
  SELECT
    COUNT(*) FILTER (WHERE notes_admin LIKE 'zoom_uuid=%')                               AS from_zoom,
    COUNT(*) FILTER (WHERE notes_admin LIKE 'zoom_occurrence=%')                          AS scheduled_from_zoom,
    COUNT(*) FILTER (WHERE notes_admin = 'on_demand')                                     AS on_demand_aula,
    COUNT(*) FILTER (WHERE notes_admin IS NULL OR notes_admin = '')                       AS sin_notes,
    COUNT(*) FILTER (WHERE notes_admin NOT LIKE 'zoom_%' AND notes_admin != 'on_demand'
                       AND notes_admin IS NOT NULL AND notes_admin != '')                 AS otros,
    COUNT(*)                                                                              AS total
   FROM classes
   WHERE teacher_id = $1`, [florian.teacher_id]);
console.log(`\n  Distribución de sus ${counts.total} clases (todos los tiempos):`);
console.log(`    desde Zoom (backfill):              ${counts.from_zoom}`);
console.log(`    futuras Zoom (zoom_occurrence):     ${counts.scheduled_from_zoom}`);
console.log(`    on_demand del aula LiveKit:         ${counts.on_demand_aula}`);
console.log(`    sin notes_admin:                    ${counts.sin_notes}`);
console.log(`    otros:                              ${counts.otros}`);

// 3. Logs de inicio/fin de aula (si existen)
const { rows: aulaUsage } = await db.query(`
  SELECT id, scheduled_at, started_at, ended_at, status, notes_admin, title,
         actual_duration_minutes, billed_hours
    FROM classes
   WHERE teacher_id = $1
     AND started_at IS NOT NULL
     AND (notes_admin IS NULL OR notes_admin NOT LIKE 'zoom_uuid=%')
   ORDER BY started_at DESC
   LIMIT 10`, [florian.teacher_id]);
console.log(`\n  Clases con started_at NO provenientes de Zoom (= aula LiveKit usada):`);
if (aulaUsage.length === 0) {
  console.log(`    🚫 NINGUNA — Florian no ha abierto el aula de LiveKit ni una vez.`);
} else {
  for (const c of aulaUsage) {
    console.log(`    ${c.started_at.toISOString().slice(0,16)}  ${c.status}  notes="${c.notes_admin ?? ""}"  "${c.title}"`);
  }
}

// 4. Tabla impersonation_log (si existe — la usa el admin para ver actividad)
try {
  const { rows: [impCount] } = await db.query(`
    SELECT COUNT(*) AS n FROM impersonation_log WHERE target_user_id = $1`, [florian.user_id]);
  console.log(`\n  Veces que se le impersonó: ${impCount.n}`);
} catch {}

await db.end();
