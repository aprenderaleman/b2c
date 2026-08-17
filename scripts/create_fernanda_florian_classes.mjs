#!/usr/bin/env node
/**
 * Crea las clases Fernanda × Florian a partir de hoy:
 *   - Lunes, Martes, Jueves, Viernes
 *   - 17:00 Berlin · 60 min
 *   - Hasta agotar los créditos de Fernanda (60 restantes)
 *   - Respeta el cap universal de 14 sesiones/mes (decisión Gelfis 2026-05-02).
 *     4 días/sem × ~4.3 sem = 17/mes → drop ≥3/mes para quedar en 14.
 *     Estrategia: greedy "primero llega, primero pasa" y skip cuando ya
 *     se llegó al cap del mes (drop natural de los últimos del mes).
 *
 * Tipo: individual · sin group_id · 1 participante (Fernanda).
 * No usa parent_class_id (no es serie recurrente del wizard, son clases
 * sueltas como las históricas).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}

function berlinOffsetMinutes(d) {
  const opts = { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false };
  const get = tz => {
    const o = Object.fromEntries(new Intl.DateTimeFormat("en-US",{...opts,timeZone:tz}).formatToParts(d).map(p=>[p.type,p.value]));
    return Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute);
  };
  return Math.round((get("Europe/Berlin")-get("UTC"))/60000);
}
function berlinIso(ymd, hhmm) {
  const [Y,M,D]=ymd.split("-").map(Number); const [h,mi]=hhmm.split(":").map(Number);
  const g=Date.UTC(Y,M-1,D,h,mi);
  return new Date(g - berlinOffsetMinutes(new Date(g))*60000).toISOString();
}
function ymd(d){return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;}

const TEACHER_ID    = "544a84e9-7cc6-4f32-a342-21a5c14a137b";
const FERNANDA_ID   = "8d4274af-7f8c-4d57-a304-54c5a03aa14a";
const TARGET_DAYS   = [1, 2, 4, 5];        // Lun, Mar, Jue, Vie
const HOUR          = "17:00";
const DURATION_MIN  = 60;                  // 1 unidad de 50min (regla 50)
const TOTAL_CREDITS = 60;                  // classes_remaining de Fernanda
const MONTHLY_CAP   = 14;                  // unidades por mes
const TITLE         = "Fernanda - VIP ";

// Empezamos hoy (Lunes 4-may). Si ya pasó la hora, el primero quedará
// en el pasado (raro y aceptable: el sistema solo lo lista en historial).
const startCursor = new Date();
startCursor.setUTCHours(0, 0, 0, 0);

const meetings = [];
const monthCounts = {};
const cursor = new Date(startCursor);

for (let safety = 0; safety < 400 && meetings.length < TOTAL_CREDITS; safety++) {
  // Día de la semana en Berlin (no UTC) para que jueves sea jueves
  // independientemente del offset horario.
  const dowBerlinFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short" }).format(cursor);
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[dowBerlinFmt];

  if (TARGET_DAYS.includes(dow)) {
    // Mes en zona Berlin para la idempotencia del cap
    const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(cursor);
    const used = monthCounts[monthKey] ?? 0;
    if (used < MONTHLY_CAP) {
      meetings.push({ iso: berlinIso(ymd(cursor), HOUR), durationMin: DURATION_MIN });
      monthCounts[monthKey] = used + 1;
    }
  }
  cursor.setUTCDate(cursor.getUTCDate() + 1);
}

console.log(`Plan: ${meetings.length} clases · primera ${meetings[0].iso} · última ${meetings[meetings.length-1].iso}`);
console.log("Distribución por mes:");
for (const [k,v] of Object.entries(monthCounts).sort()) console.log(`  ${k}  ${v} sesiones`);

const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query("BEGIN");
try {
  // Insertar todas las clases sin parent_class_id (son sueltas, como
  // las históricas de Fernanda)
  let inserted = 0;
  for (const m of meetings) {
    const { rows: [cls] } = await c.query(`
      INSERT INTO classes (type, teacher_id, title, recurrence_pattern, status,
                           scheduled_at, duration_minutes)
      VALUES ('individual', $1, $2, 'none', 'scheduled', $3, $4)
      RETURNING id`,
      [TEACHER_ID, TITLE, m.iso, m.durationMin]);
    await c.query(`
      INSERT INTO class_participants (class_id, student_id)
      VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [cls.id, FERNANDA_ID]);
    inserted++;
  }
  console.log(`\n✓ ${inserted} clases creadas`);
  await c.query("COMMIT");
  console.log("✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación
const { rows: vfy } = await c.query(`
  SELECT to_char(cls.scheduled_at AT TIME ZONE 'Europe/Berlin', 'Dy YYYY-MM-DD HH24:MI') AS berlin
    FROM classes cls
    JOIN class_participants cp ON cp.class_id = cls.id
   WHERE cp.student_id = $1 AND cls.teacher_id = $2 AND cls.status = 'scheduled'
   ORDER BY cls.scheduled_at LIMIT 8`, [FERNANDA_ID, TEACHER_ID]);
console.log("\nPrimeras 8 clases agendadas (Berlín):");
for (const r of vfy) console.log(" ", r.berlin);

await c.end();
