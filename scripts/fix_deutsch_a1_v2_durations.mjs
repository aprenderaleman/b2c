#!/usr/bin/env node
/**
 * Fix Deutsch A1 Abends V2 — las sesiones son de 120 min (2h = 2 clases),
 * no de 60 min. Por la regla universal "1h = 1 clase":
 *
 *   - Lydia tiene 70 → 35 sesiones × 2h
 *   - Natalia tiene 84 → 42 sesiones × 2h
 *   - cap = min(35, 42) = 35 sesiones
 *
 * Estado actual: 70 filas × 60 min (mal).
 * Estado deseado: 35 filas × 120 min, alternando Jue 19:00 / Vie 18:00.
 *
 * Estrategia: borrar las filas (clases scheduled, sin participación
 * todavía) y re-insertar 35 con duration_minutes=120 desde el 2026-05-07.
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
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

function berlinOffsetMinutes(date) {
  const opts = { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false };
  const get = tz => {
    const o = Object.fromEntries(new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).formatToParts(date).map(p=>[p.type,p.value]));
    return Date.UTC(+o.year, +o.month-1, +o.day, +o.hour, +o.minute);
  };
  return Math.round((get("Europe/Berlin") - get("UTC")) / 60000);
}
function berlinWallClockToIso(ymd, hhmm) {
  const [Y,M,D] = ymd.split("-").map(Number);
  const [h,mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Y, M-1, D, h, mi);
  return new Date(guess - berlinOffsetMinutes(new Date(guess))*60000).toISOString();
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

const GROUP_ID = "011f72c4-b323-43f1-8515-c2e8a64c6c74";
const TEACHER_ID = "544a84e9-7cc6-4f32-a342-21a5c14a137b";
const LYDIA = "47735a91-75a3-43a3-81d4-4261e0bf2c37";
const NATALIA = "7bab7736-e725-40c2-a063-be28d2bd0a55";
const SLOTS = [{ weekday: 4, time: "19:00" }, { weekday: 5, time: "18:00" }];
const FIRST = "2026-05-07";
const TOTAL_MEETINGS = 35;        // = floor(min_remaining / hours_per_session) = floor(70/2)
const DURATION = 120;

await c.query("BEGIN");
try {
  // 1) Borrar las clases viejas + sus participantes
  const { rows: oldClasses } = await c.query(
    `SELECT id FROM classes WHERE group_id = $1`, [GROUP_ID]);
  console.log(`Borrando ${oldClasses.length} clases viejas (60min) + sus participantes…`);
  await c.query(`DELETE FROM class_participants WHERE class_id = ANY($1::uuid[])`, [oldClasses.map(r=>r.id)]);
  await c.query(`DELETE FROM classes WHERE group_id = $1`, [GROUP_ID]);

  // 2) Generar las 35 sesiones × 120 min
  const cursor = new Date(`${FIRST}T00:00:00Z`);
  const meetings = [];
  for (let safety = 0; safety < TOTAL_MEETINGS * 7 + 14 && meetings.length < TOTAL_MEETINGS; safety++) {
    const dow = cursor.getUTCDay();
    const slot = SLOTS.find(s => s.weekday === dow);
    if (slot) meetings.push(berlinWallClockToIso(ymd(cursor), slot.time));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  meetings.sort();

  // 3) Insertar parent + resto
  const { rows: [parent] } = await c.query(`
    INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status,
                         scheduled_at, duration_minutes, parent_class_id)
    VALUES ('group', $1, 'Deutsch A1 Abends V2', $2, 'none', 'scheduled', $3, $4, NULL)
    RETURNING id`,
    [TEACHER_ID, GROUP_ID, meetings[0], DURATION]);
  await c.query(`UPDATE classes SET parent_class_id = $1 WHERE id = $1`, [parent.id]);
  const all = [parent.id];
  for (const iso of meetings.slice(1)) {
    const { rows: [r] } = await c.query(`
      INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status,
                           scheduled_at, duration_minutes, parent_class_id)
      VALUES ('group', $1, 'Deutsch A1 Abends V2', $2, 'none', 'scheduled', $3, $4, $5)
      RETURNING id`,
      [TEACHER_ID, GROUP_ID, iso, DURATION, parent.id]);
    all.push(r.id);
  }
  console.log(`✓ ${all.length} sesiones × ${DURATION}min creadas (primera ${meetings[0]}, última ${meetings[meetings.length-1]})`);

  // 4) Re-vincular participantes
  for (const sid of [LYDIA, NATALIA]) {
    for (const clsId of all) {
      await c.query(`
        INSERT INTO class_participants (class_id, student_id)
        VALUES ($1, $2) ON CONFLICT (class_id, student_id) DO NOTHING`,
        [clsId, sid]);
    }
  }
  console.log(`✓ Participantes re-vinculados`);

  // 5) Actualizar total_sessions del grupo (= clases en términos de horas)
  await c.query(`UPDATE student_groups SET total_sessions = $1 WHERE id = $2`,
    [TOTAL_MEETINGS * (DURATION/60), GROUP_ID]);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

const { rows: vfy } = await c.query(`
  SELECT to_char(scheduled_at AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS berlin, duration_minutes
    FROM classes WHERE group_id = '011f72c4-b323-43f1-8515-c2e8a64c6c74' ORDER BY scheduled_at LIMIT 6`);
console.log("\nPrimeras 6 sesiones (Berlín):");
for (const r of vfy) console.log(` ${r.berlin}  ${r.duration_minutes}min`);
const { rows: tail } = await c.query(`
  SELECT to_char(scheduled_at AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS berlin
    FROM classes WHERE group_id = '011f72c4-b323-43f1-8515-c2e8a64c6c74' ORDER BY scheduled_at DESC LIMIT 1`);
console.log(`Última: ${tail[0].berlin}`);
await c.end();
