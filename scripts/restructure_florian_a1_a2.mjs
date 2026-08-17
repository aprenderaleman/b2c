#!/usr/bin/env node
/**
 * Restructura los 2 grupos de Florian por nivel real (decisión Gelfis 2026-05-06):
 *
 *   • Deutsch A1 Abends   (Lun 19:00 + Jue 19:00 × 100min) → Lydia + Luis Emilio
 *   • Deutsch A2 Abends   (Mié 18:00 + Vie 18:00 × 100min) → Francisco + Natalia
 *
 * Pasos:
 *   1. Borrar TODAS las clases scheduled futuras de los 2 grupos previos:
 *        - "Deutsch A1 - B1 Abends"   (id e9ad8e77)
 *        - "Deutsch A1 Abends V2"     (id 011f72c4)
 *   2. Renombrar y reasignar miembros:
 *        - V2 → "Deutsch A1 Abends" (Lydia + Luis Emilio)
 *        - A1-B1 → "Deutsch A2 Abends" (Francisco + Natalia)
 *   3. Generar las nuevas series respetando cap 14 unidades/mes y
 *      el saldo del miembro con menos créditos:
 *        - A1 cap = min(Lydia 70, Luis Emilio 70) = 70u → 35 ses × 2u
 *        - A2 cap = min(Francisco 83, Natalia 84) = 83u → 41 ses × 2u (queda 1 a Francisco)
 *   4. Imprimir preview de mensajes para Gelfis (no se envían — paso 2 manual)
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

const TEACHER_ID = "544a84e9-7cc6-4f32-a342-21a5c14a137b";

// IDs (ya identificados de auditorías previas)
const GROUP_A1B1 = "e9ad8e77-4a2a-4e52-abe8-4cf15e2b87b7";   // pasa a "Deutsch A2 Abends"
const GROUP_V2   = "011f72c4-b323-43f1-8515-c2e8a64c6c74";   // pasa a "Deutsch A1 Abends"

// Configuraciones nuevas
const A1 = {
  groupId: GROUP_V2,
  newName: "Deutsch A1 Abends",
  level: "A1",
  members: [
    { id: "47735a91-75a3-43a3-81d4-4261e0bf2c37", name: "Lydia" },
    null, // se rellena con Luis Emilio
  ],
  slots: [
    { weekday: 1, time: "19:00" },  // Lun
    { weekday: 4, time: "19:00" },  // Jue
  ],
  totalSes: 35,   // = 70u / 2u por sesión
};
const A2 = {
  groupId: GROUP_A1B1,
  newName: "Deutsch A2 Abends",
  level: "A2",
  members: [
    null, // Francisco
    { id: "7bab7736-e725-40c2-a063-be28d2bd0a55", name: "Natalia Paniagua" },
  ],
  slots: [
    { weekday: 3, time: "18:00" },  // Mié
    { weekday: 5, time: "18:00" },  // Vie
  ],
  totalSes: 41,   // = 82u / 2u por sesión (cap Francisco)
};
const DURATION_MIN = 100;
const UNITS_PER_SES = 2;
const MONTHLY_CAP = 14;

const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// Resolver Luis Emilio + Francisco IDs
const stu = await c.query(`SELECT s.id, u.full_name FROM students s JOIN users u ON u.id=s.user_id WHERE u.full_name ILIKE 'Luis Emilio%' OR u.full_name ILIKE 'Francisco%'`);
const luis = stu.rows.find(r => /luis emilio/i.test(r.full_name))?.id;
const francisco = stu.rows.find(r => /francisco/i.test(r.full_name))?.id;
if (!luis || !francisco) { console.error("✗ No encontré Luis Emilio o Francisco"); process.exit(1); }
A1.members[1] = { id: luis, name: "Luis Emilio" };
A2.members[0] = { id: francisco, name: "Francisco" };

await c.query("BEGIN");
try {
  // 1. Borrar clases scheduled futuras de ambos grupos
  for (const gid of [GROUP_A1B1, GROUP_V2]) {
    const old = await c.query(`SELECT id FROM classes WHERE group_id=$1 AND status='scheduled' AND scheduled_at > NOW()`, [gid]);
    const ids = old.rows.map(r => r.id);
    if (ids.length) {
      await c.query(`DELETE FROM class_participants WHERE class_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [ids]);
      console.log(`✓ Borradas ${ids.length} clases del grupo ${gid.slice(0,8)}`);
    }
  }

  // 2. Renombrar grupos + actualizar miembros
  for (const cfg of [A1, A2]) {
    await c.query(`UPDATE student_groups SET name=$1, level=$2::cefr_level, levels=ARRAY[$2]::cefr_level[] WHERE id=$3`,
      [cfg.newName, cfg.level, cfg.groupId]);
    // Limpiar miembros viejos y poner los nuevos
    await c.query(`DELETE FROM student_group_members WHERE group_id=$1`, [cfg.groupId]);
    for (const m of cfg.members) {
      await c.query(`INSERT INTO student_group_members (group_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [cfg.groupId, m.id]);
    }
    console.log(`✓ Grupo ${cfg.newName}: miembros = ${cfg.members.map(m=>m.name).join(", ")}`);
  }

  // 3. Generar clases
  for (const cfg of [A1, A2]) {
    const meetings = [];
    const monthCounts = {};
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);  // empezar mañana

    for (let safety=0; safety<400 && meetings.length < cfg.totalSes; safety++) {
      const dowBerlin = new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",weekday:"short"}).format(cursor);
      const dow = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[dowBerlin];
      const slot = cfg.slots.find(s => s.weekday === dow);
      if (slot) {
        const monthKey = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit"}).format(cursor);
        const used = monthCounts[monthKey] ?? 0;
        if (used + UNITS_PER_SES <= MONTHLY_CAP) {
          meetings.push({ iso: berlinIso(ymd(cursor), slot.time) });
          monthCounts[monthKey] = used + UNITS_PER_SES;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // Insertar serie
    const { rows:[parent] } = await c.query(`
      INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status, scheduled_at, duration_minutes, parent_class_id)
      VALUES ('group', $1, $2, $3, 'none', 'scheduled', $4, $5, NULL) RETURNING id`,
      [TEACHER_ID, cfg.newName, cfg.groupId, meetings[0].iso, DURATION_MIN]);
    await c.query(`UPDATE classes SET parent_class_id=$1 WHERE id=$1`, [parent.id]);
    const allIds = [parent.id];
    for (const m of meetings.slice(1)) {
      const { rows:[r] } = await c.query(`
        INSERT INTO classes (type, teacher_id, title, group_id, recurrence_pattern, status, scheduled_at, duration_minutes, parent_class_id)
        VALUES ('group', $1, $2, $3, 'none', 'scheduled', $4, $5, $6) RETURNING id`,
        [TEACHER_ID, cfg.newName, cfg.groupId, m.iso, DURATION_MIN, parent.id]);
      allIds.push(r.id);
    }
    for (const mem of cfg.members) {
      for (const cid of allIds) {
        await c.query(`INSERT INTO class_participants (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [cid, mem.id]);
      }
    }
    await c.query(`UPDATE student_groups SET total_sessions=$1 WHERE id=$2`, [cfg.totalSes * UNITS_PER_SES, cfg.groupId]);
    console.log(`✓ ${cfg.newName}: ${allIds.length} clases generadas (${Object.entries(monthCounts).map(([k,v])=>`${k}:${v}u`).join(", ")})`);
  }

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación
const v = await c.query(`
  SELECT to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS berlin,
         g.name, c.duration_minutes,
         (SELECT array_agg(u.full_name) FROM class_participants cp JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id WHERE cp.class_id=c.id) AS alumnos
    FROM classes c LEFT JOIN student_groups g ON g.id=c.group_id
   WHERE c.teacher_id='544a84e9-7cc6-4f32-a342-21a5c14a137b'
     AND c.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '14 days'
     AND c.status='scheduled' AND c.title NOT ILIKE '%Fernanda%'
   ORDER BY c.scheduled_at`);
console.log("\n═══ Calendario Florian (próx 14 días, sin Fernanda) ═══");
for (const x of v.rows) console.log(' ', x.berlin, String(x.duration_minutes).padStart(3)+'min', '"'+x.name+'"', '·', (x.alumnos??[]).join(', '));

await c.end();
