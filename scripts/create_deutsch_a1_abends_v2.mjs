#!/usr/bin/env node
/**
 * Crear grupo "Deutsch A1 Abends V2" — Florian + Lydia + Natalia
 *   - Jueves 19:00 (Berlin) · 60 min
 *   - Viernes 18:00 (Berlin) · 60 min
 *   - Cap: min(classes_remaining) de los 2 estudiantes = 70 (Lydia)
 *
 * Genera clases alternando Jueves/Viernes desde el próximo jueves
 * (2026-05-07) hasta agotar el cupo.
 *
 * Esto se ejecuta como one-off porque el wizard actual no soporta
 * "varios slots semanales" (un horario por día). En paralelo añadimos
 * el modo `weekly_slots` para que en el futuro se haga desde la UI.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// ─── Berlin wall-clock → UTC ISO ──────────────────────────
function berlinOffsetMinutes(date) {
  const opts = { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false };
  const utc = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  const ber = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "Europe/Berlin" });
  const get = f => {
    const o = Object.fromEntries(f.formatToParts(date).map(p=>[p.type,p.value]));
    return Date.UTC(+o.year, +o.month-1, +o.day, +o.hour, +o.minute);
  };
  return Math.round((get(ber) - get(utc)) / 60000);
}
function berlinWallClockToIso(ymd, hhmm) {
  const [Y,M,D] = ymd.split("-").map(Number);
  const [h,mi]  = hhmm.split(":").map(Number);
  const guess   = Date.UTC(Y, M-1, D, h, mi);
  const offset  = berlinOffsetMinutes(new Date(guess));
  return new Date(guess - offset*60000).toISOString();
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

// ─── Plan de clases ───────────────────────────────────────
const SLOTS = [
  { weekday: 4, time: "19:00", durationMin: 60 },  // Jueves
  { weekday: 5, time: "18:00", durationMin: 60 },  // Viernes
];
const FIRST_DATE = "2026-05-07";   // próximo jueves
const TOTAL = 70;                  // = min(classes_remaining)

const start = new Date(`${FIRST_DATE}T00:00:00Z`);
const cursor = new Date(start);
const classes = [];
for (let safety = 0; safety < TOTAL * 7 + 14 && classes.length < TOTAL; safety++) {
  const dow = cursor.getUTCDay();          // 0 = Sun … 6 = Sat
  const slot = SLOTS.find(s => s.weekday === dow);
  if (slot) {
    classes.push({
      iso: berlinWallClockToIso(ymd(cursor), slot.time),
      duration: slot.durationMin,
    });
  }
  cursor.setUTCDate(cursor.getUTCDate() + 1);
}
classes.sort((a,b) => a.iso.localeCompare(b.iso));
console.log(`Plan: ${classes.length} clases, primera ${classes[0].iso}, última ${classes[classes.length-1].iso}\n`);

await c.query("BEGIN");
try {
  const TEACHER_ID = "544a84e9-7cc6-4f32-a342-21a5c14a137b";
  const LYDIA      = "47735a91-75a3-43a3-81d4-4261e0bf2c37";
  const NATALIA    = "7bab7736-e725-40c2-a063-be28d2bd0a55";

  // 1) Insert group
  const { rows: [grp] } = await c.query(`
    INSERT INTO student_groups (name, class_type, level, levels, teacher_id, capacity, total_sessions, active)
    VALUES ('Deutsch A1 Abends V2', 'group', 'A1'::cefr_level, ARRAY['A1']::cefr_level[], $1, 10, $2, true)
    RETURNING id`,
    [TEACHER_ID, TOTAL]);
  console.log(`✓ Grupo creado: ${grp.id}`);

  // 2) Insert classes — primera = parent
  const first = classes[0];
  const { rows: [parent] } = await c.query(`
    INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status,
                         scheduled_at, duration_minutes, parent_class_id)
    VALUES ('group', $1, 'Deutsch A1 Abends V2', $2, 'none', 'scheduled', $3, $4, NULL)
    RETURNING id`,
    [TEACHER_ID, grp.id, first.iso, first.duration]);
  await c.query(`UPDATE classes SET parent_class_id = $1 WHERE id = $1`, [parent.id]);

  const allClassIds = [parent.id];
  for (const cls of classes.slice(1)) {
    const { rows: [r] } = await c.query(`
      INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status,
                           scheduled_at, duration_minutes, parent_class_id)
      VALUES ('group', $1, 'Deutsch A1 Abends V2', $2, 'none', 'scheduled', $3, $4, $5)
      RETURNING id`,
      [TEACHER_ID, grp.id, cls.iso, cls.duration, parent.id]);
    allClassIds.push(r.id);
  }
  console.log(`✓ ${allClassIds.length} clases creadas (parent=${parent.id})`);

  // 3) Members → student_group_members + class_participants
  for (const sid of [LYDIA, NATALIA]) {
    await c.query(`
      INSERT INTO student_group_members (group_id, student_id)
      VALUES ($1, $2) ON CONFLICT (group_id, student_id) DO NOTHING`,
      [grp.id, sid]);
    for (const clsId of allClassIds) {
      await c.query(`
        INSERT INTO class_participants (class_id, student_id)
        VALUES ($1, $2) ON CONFLICT (class_id, student_id) DO NOTHING`,
        [clsId, sid]);
    }
  }
  console.log(`✓ Miembros + participantes vinculados (Lydia + Natalia × ${allClassIds.length} clases)`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación
const { rows: vfy } = await c.query(`
  SELECT u.full_name, s.classes_remaining
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE s.id IN ('47735a91-75a3-43a3-81d4-4261e0bf2c37','7bab7736-e725-40c2-a063-be28d2bd0a55')
   ORDER BY u.full_name`);
console.log("\n══════════ classes_remaining tras creación ══════════");
for (const r of vfy) console.log(`  ${r.full_name?.padEnd(20)}  ${r.classes_remaining}`);

const { rows: nxt } = await c.query(`
  SELECT cls.scheduled_at AT TIME ZONE 'Europe/Berlin' AS berlin_local
    FROM classes cls JOIN student_groups g ON g.id = cls.group_id
   WHERE g.name = 'Deutsch A1 Abends V2'
   ORDER BY cls.scheduled_at LIMIT 6`);
console.log("\n══════════ Primeras 6 clases (Berlin) ══════════");
for (const r of nxt) console.log(`  ${r.berlin_local.toISOString().replace('T',' ').slice(0,16)}`);

await c.end();
