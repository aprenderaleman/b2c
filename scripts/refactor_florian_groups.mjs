#!/usr/bin/env node
/**
 * Refactoriza los grupos de Florian (decisión Gelfis 2026-05-04):
 *
 * • V2 (Lydia + Natalia) — Jue 19:00 + Vie 18:00 × 100min ya está bien
 *   agendado (35 sesiones May→Sep, 7/mes, total 70 unidades = cap Lydia).
 *   NO se toca.
 *
 * • A1 - B1 (Francisco + Luis Emilio) — pasa de tener UNA clase huérfana
 *   el 7-may a un horario regular: Lun 19:00 + Mié 18:00 × 100min,
 *   7 reuniones/mes (= 14 unidades), hasta agotar créditos del miembro
 *   con menos saldo (Luis Emilio: 70 unidades → 35 sesiones).
 *
 * Esto resuelve el conflicto del jueves 7-may 19:00 donde ambos grupos
 * coincidían: borramos la clase huérfana de A1-B1 y la sustituimos por
 * el patrón nuevo Lun/Mié.
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
const A1B1_GROUP_ID = "e9ad8e77-...";  // se resuelve en runtime más abajo
const TARGET_DAYS   = [1, 3];           // Lun, Mié
const SLOT_TIMES    = { 1: "19:00", 3: "18:00" };  // Mon=19, Wed=18
const DURATION_MIN  = 100;
const TOTAL_UNITS   = 70;               // Luis Emilio: classes_remaining=70
const UNITS_PER_SES = 2;                // 100min → 2 unidades (regla 50min)
const TOTAL_SES     = TOTAL_UNITS / UNITS_PER_SES;  // 35
const MONTHLY_CAP   = 14;               // unidades/mes → max 7 sesiones/mes

const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// 1. Resolver el group_id real por nombre
const gr = await c.query(`SELECT id, name FROM student_groups WHERE teacher_id=$1 AND name ILIKE 'Deutsch A1%B1%Abends%' AND active=TRUE LIMIT 1`, [TEACHER_ID]);
if (!gr.rows[0]) { console.error("✗ No encontré grupo A1-B1 Abends"); process.exit(1); }
const groupId = gr.rows[0].id;
const groupName = gr.rows[0].name;
console.log(`Grupo A1-B1: ${groupId} "${groupName}"`);

await c.query("BEGIN");
try {
  // 2. Borrar todas las clases scheduled futuras de A1-B1
  const oldClasses = await c.query(`SELECT id FROM classes WHERE group_id=$1 AND status='scheduled' AND scheduled_at > NOW()`, [groupId]);
  const oldIds = oldClasses.rows.map(r => r.id);
  if (oldIds.length > 0) {
    await c.query(`DELETE FROM class_participants WHERE class_id = ANY($1::uuid[])`, [oldIds]);
    await c.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [oldIds]);
    console.log(`✓ Borradas ${oldIds.length} clases huérfanas`);
  }

  // 3. Resolver IDs de alumnos
  const stu = await c.query(`SELECT s.id, u.full_name FROM students s JOIN users u ON u.id=s.user_id WHERE u.full_name ILIKE 'Francisco%' OR u.full_name ILIKE 'Luis Emilio%'`);
  const memberIds = stu.rows.map(r => r.id);
  console.log(`Miembros: ${stu.rows.map(r=>r.full_name.trim()).join(", ")}`);

  // 4. Generar 35 sesiones Lun/Mié desde mañana
  const meetings = [];
  const monthCounts = {};
  const cursor = new Date();
  cursor.setUTCHours(0,0,0,0);
  // empezar por mañana para garantizar que cualquier 19:00 hoy ya pasado no se cuela
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  for (let safety=0; safety<400 && meetings.length < TOTAL_SES; safety++) {
    const dowBerlin = new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",weekday:"short"}).format(cursor);
    const dowMap = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    const dow = dowMap[dowBerlin];
    if (TARGET_DAYS.includes(dow)) {
      const monthKey = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit"}).format(cursor);
      const used = monthCounts[monthKey] ?? 0;
      if (used + UNITS_PER_SES <= MONTHLY_CAP) {
        meetings.push({ iso: berlinIso(ymd(cursor), SLOT_TIMES[dow]), durationMin: DURATION_MIN });
        monthCounts[monthKey] = used + UNITS_PER_SES;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  console.log(`Plan: ${meetings.length} sesiones`);
  console.log("Distribución por mes (en unidades):");
  for (const [k,v] of Object.entries(monthCounts).sort()) console.log(`  ${k}  ${v} uds (${v/UNITS_PER_SES} ses)`);

  // 5. Insertar como serie (parent = la primera)
  const { rows: [parent] } = await c.query(`
    INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status, scheduled_at, duration_minutes, parent_class_id)
    VALUES ('group', $1, $2, $3, 'none', 'scheduled', $4, $5, NULL) RETURNING id`,
    [TEACHER_ID, groupName, groupId, meetings[0].iso, meetings[0].durationMin]);
  await c.query(`UPDATE classes SET parent_class_id=$1 WHERE id=$1`, [parent.id]);
  const allIds = [parent.id];
  for (const m of meetings.slice(1)) {
    const { rows:[r] } = await c.query(`
      INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status, scheduled_at, duration_minutes, parent_class_id)
      VALUES ('group', $1, $2, $3, 'none', 'scheduled', $4, $5, $6) RETURNING id`,
      [TEACHER_ID, groupName, groupId, m.iso, m.durationMin, parent.id]);
    allIds.push(r.id);
  }
  // 6. Vincular participantes
  for (const sid of memberIds) {
    for (const cid of allIds) {
      await c.query(`INSERT INTO class_participants (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [cid, sid]);
    }
  }
  await c.query(`UPDATE student_groups SET total_sessions=$1 WHERE id=$2`, [TOTAL_UNITS, groupId]);
  console.log(`✓ ${allIds.length} sesiones × ${DURATION_MIN}min creadas en ${groupName}`);

  await c.query("COMMIT");
  console.log("✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación final: jueves 7-may sin choque + ambos grupos sanos
console.log("\n═══ Verificación: Florian jueves/viernes/lunes/miércoles próximas 14d ═══");
const v = await c.query(`
  SELECT to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS berlin,
         c.duration_minutes, g.name AS grupo,
         (SELECT array_agg(u.full_name) FROM class_participants cp JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id WHERE cp.class_id=c.id) AS alumnos
    FROM classes c LEFT JOIN student_groups g ON g.id=c.group_id
   WHERE c.teacher_id='544a84e9-7cc6-4f32-a342-21a5c14a137b'
     AND c.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '14 days'
     AND c.status='scheduled' AND c.title NOT ILIKE '%Fernanda%'
   ORDER BY c.scheduled_at`);
for (const x of v.rows) console.log(' ', x.berlin, String(x.duration_minutes).padStart(3)+'min', '"'+x.grupo+'"', '·', (x.alumnos??[]).join(', '));

await c.end();
