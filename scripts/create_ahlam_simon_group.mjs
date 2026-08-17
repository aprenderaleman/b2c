#!/usr/bin/env node
/**
 * Crear grupo Ahlam × Simon (1-on-1) con clases Lun/Mié/Vie 21:00 Berlín
 * × 60 min, hasta agotar los 51 créditos de Ahlam. Respeta cap 14/mes.
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
  const opts={year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false};
  const get=tz=>{const o=Object.fromEntries(new Intl.DateTimeFormat("en-US",{...opts,timeZone:tz}).formatToParts(d).map(p=>[p.type,p.value]));return Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute);};
  return Math.round((get("Europe/Berlin")-get("UTC"))/60000);
}
function berlinIso(ymd, hhmm) {
  const [Y,M,D]=ymd.split("-").map(Number);const [h,mi]=hhmm.split(":").map(Number);
  const g=Date.UTC(Y,M-1,D,h,mi);
  return new Date(g - berlinOffsetMinutes(new Date(g))*60000).toISOString();
}
function ymd(d){return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;}
function berlinWeekday(d) {
  const map={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return map[new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",weekday:"short"}).format(d)];
}
function berlinMonth(d){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit"}).format(d);}

const SIMON  = "42aa943a-d305-420f-83bb-da0f68df6b7f";
const AHLAM  = "cf23c9c4-dc68-49d2-8138-0b1275718c90";
const TOTAL  = 51;
const CAP    = 14;
const DAYS   = [1, 3, 5];   // Lun, Mié, Vie
const HOUR   = "21:00";
const DUR    = 60;

const start = new Date("2026-05-15T00:00:00Z");  // próximo Vie 15 may
const cursor = new Date(start);
const meetings = [];
const monthCount = {};
for (let safety=0; safety<400 && meetings.length<TOTAL; safety++) {
  const dow = berlinWeekday(cursor);
  if (DAYS.includes(dow)) {
    const monthKey = berlinMonth(cursor);
    if ((monthCount[monthKey]??0) < CAP) {
      meetings.push(berlinIso(ymd(cursor), HOUR));
      monthCount[monthKey] = (monthCount[monthKey]??0) + 1;
    }
  }
  cursor.setUTCDate(cursor.getUTCDate()+1);
}
console.log(`Plan: ${meetings.length} clases · primera ${meetings[0]} · última ${meetings[meetings.length-1]}`);
console.log("Distribución por mes:", monthCount);

const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query("BEGIN");
try {
  // 1. Crear el grupo
  const { rows: [grp] } = await c.query(`
    INSERT INTO student_groups (name, class_type, level, levels, teacher_id, capacity, total_sessions, active)
    VALUES ('Ahlam — Deutsch A1', 'individual', 'A1'::cefr_level, ARRAY['A1']::cefr_level[], $1, 1, $2, true)
    RETURNING id`, [SIMON, TOTAL]);
  console.log("✓ Grupo creado:", grp.id);

  // 2. Member
  await c.query(`INSERT INTO student_group_members (group_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [grp.id, AHLAM]);

  // 3. Insertar clases con parent_class_id
  const first = meetings[0];
  const { rows: [parent] } = await c.query(`
    INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status, scheduled_at, duration_minutes, parent_class_id)
    VALUES ('individual', $1, 'Ahlam — Clase individual', $2, 'none', 'scheduled', $3, $4, NULL)
    RETURNING id`, [SIMON, grp.id, first, DUR]);
  await c.query(`UPDATE classes SET parent_class_id = $1 WHERE id = $1`, [parent.id]);

  const allIds = [parent.id];
  for (const iso of meetings.slice(1)) {
    const { rows: [r] } = await c.query(`
      INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status, scheduled_at, duration_minutes, parent_class_id)
      VALUES ('individual', $1, 'Ahlam — Clase individual', $2, 'none', 'scheduled', $3, $4, $5)
      RETURNING id`, [SIMON, grp.id, iso, DUR, parent.id]);
    allIds.push(r.id);
  }
  console.log(`✓ ${allIds.length} clases creadas`);

  // 4. Participantes
  for (const clsId of allIds) {
    await c.query(`INSERT INTO class_participants (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [clsId, AHLAM]);
  }
  console.log(`✓ Ahlam vinculada a ${allIds.length} clases`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exit(1);
}

const v = await c.query(`
  SELECT to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS berlin, c.duration_minutes
    FROM classes c JOIN student_groups g ON g.id=c.group_id
   WHERE g.name='Ahlam — Deutsch A1' ORDER BY c.scheduled_at LIMIT 6`);
console.log("\nPrimeras 6 (Berlín):");
for (const r of v.rows) console.log(" ", r.berlin, r.duration_minutes+"min");
const last = await c.query(`SELECT to_char(MAX(c.scheduled_at) AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS last FROM classes c JOIN student_groups g ON g.id=c.group_id WHERE g.name='Ahlam — Deutsch A1'`);
console.log("Última:", last.rows[0].last);

await c.end();
