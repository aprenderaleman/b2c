#!/usr/bin/env node
/**
 * Aplica el cap "≤14 unidades de 50min por mes y por estudiante" a las
 * clases ya agendadas desde mayo 2026 en adelante. Decisión Gelfis 2026-05-02.
 *
 * Estrategia:
 *   1. Deutsch A1 – B1 Morgens (Mon+Wed × 120min): drop May 27 → 7 sesiones
 *   2. Ayman Kayali (individual Mon-Thu × 60min):
 *      - May: drop Jueves 21 y 28 → 14 sesiones
 *      - Jun: drop todos los jueves (4) → 14 sesiones
 *   3. Deutsch A1 Abends V2: regenerar al ritmo 7 reuniones/mes
 *      (= 14 unidades), de mayo a septiembre = 35 reuniones × 100min
 *      = 70 unidades (cap exacto de Lydia)
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
    const o = Object.fromEntries(new Intl.DateTimeFormat("en-US",{...opts,timeZone:tz}).formatToParts(date).map(p=>[p.type,p.value]));
    return Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute);
  };
  return Math.round((get("Europe/Berlin")-get("UTC"))/60000);
}
function berlinIso(ymd, hhmm) {
  const [Y,M,D]=ymd.split("-").map(Number); const [h,mi]=hhmm.split(":").map(Number);
  const g=Date.UTC(Y,M-1,D,h,mi); return new Date(g - berlinOffsetMinutes(new Date(g))*60000).toISOString();
}
function ymd(d){return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;}

await c.query("BEGIN");
try {
  // ── 1. Trim Morgens ──
  const drop1 = await c.query(`
    DELETE FROM class_participants
     WHERE class_id IN (
       SELECT cls.id FROM classes cls
        JOIN student_groups g ON g.id = cls.group_id
       WHERE g.name = 'Deutsch A1 – B1 Morgens'
         AND cls.scheduled_at::date = '2026-05-27'
         AND cls.status = 'scheduled')`);
  const drop1c = await c.query(`
    DELETE FROM classes
     WHERE id IN (
       SELECT cls.id FROM classes cls
        JOIN student_groups g ON g.id = cls.group_id
       WHERE g.name = 'Deutsch A1 – B1 Morgens'
         AND cls.scheduled_at::date = '2026-05-27'
         AND cls.status = 'scheduled')
     RETURNING id`);
  console.log(`✓ Morgens: borrado ${drop1c.rowCount} clase del 27-may (${drop1.rowCount} participantes)`);

  // ── 2. Trim Ayman ──
  const aymanDates = [
    "2026-05-21", "2026-05-28",                                    // jueves de mayo (drop 2)
    "2026-06-04", "2026-06-11", "2026-06-18", "2026-06-25",        // todos los jueves de junio (drop 4)
  ];
  const dropA = await c.query(`
    DELETE FROM classes
     WHERE id IN (
       SELECT c.id FROM classes c
        JOIN class_participants cp ON cp.class_id = c.id
        JOIN students s ON s.id = cp.student_id
        JOIN users u ON u.id = s.user_id
       WHERE u.full_name ILIKE 'Ayman%'
         AND c.status = 'scheduled'
         AND c.scheduled_at::date = ANY($1::date[]))
     RETURNING id`, [aymanDates]);
  console.log(`✓ Ayman: borradas ${dropA.rowCount} clases (jueves de may + jun)`);

  // ── 3. Regenerar V2 ──
  const GROUP_V2 = "011f72c4-b323-43f1-8515-c2e8a64c6c74";
  const TEACHER  = "544a84e9-7cc6-4f32-a342-21a5c14a137b";
  const LYDIA    = "47735a91-75a3-43a3-81d4-4261e0bf2c37";
  const NATALIA  = "7bab7736-e725-40c2-a063-be28d2bd0a55";

  const { rows: oldV2 } = await c.query(`SELECT id FROM classes WHERE group_id=$1`, [GROUP_V2]);
  await c.query(`DELETE FROM class_participants WHERE class_id = ANY($1::uuid[])`, [oldV2.map(r=>r.id)]);
  await c.query(`DELETE FROM classes WHERE group_id=$1`, [GROUP_V2]);
  console.log(`✓ V2: borradas ${oldV2.length} clases viejas`);

  // Genera Thu+Fri × 100min con cap 7 reuniones/mes; máximo 35 reuniones
  const SLOTS = [{wd:4,t:"19:00"},{wd:5,t:"18:00"}];
  const TOTAL = 35;
  const CAP_PER_MONTH = 7;

  const cursor = new Date("2026-05-07T00:00:00Z");
  const meetings = [];
  const monthCounts = {};
  for (let i=0; i<400 && meetings.length<TOTAL; i++) {
    const dow = cursor.getUTCDay();
    const slot = SLOTS.find(s => s.wd === dow);
    if (slot) {
      const monthKey = ymd(cursor).slice(0,7);
      if ((monthCounts[monthKey]??0) < CAP_PER_MONTH) {
        meetings.push({ iso: berlinIso(ymd(cursor), slot.t), durationMin: 100 });
        monthCounts[monthKey] = (monthCounts[monthKey]??0) + 1;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  console.log(`  Plan V2: ${meetings.length} reuniones, distribución por mes:`, monthCounts);

  // Insertar como secuencia con parent
  const { rows: [parent] } = await c.query(`
    INSERT INTO classes (type,teacher_id,title,group_id,recurrence_pattern,status,scheduled_at,duration_minutes,parent_class_id)
    VALUES ('group',$1,'Deutsch A1 Abends V2',$2,'none','scheduled',$3,$4,NULL) RETURNING id`,
    [TEACHER, GROUP_V2, meetings[0].iso, meetings[0].durationMin]);
  await c.query(`UPDATE classes SET parent_class_id=$1 WHERE id=$1`, [parent.id]);
  const allIds = [parent.id];
  for (const m of meetings.slice(1)) {
    const { rows:[r] } = await c.query(`
      INSERT INTO classes (type,teacher_id,title,group_id,recurrence_pattern,status,scheduled_at,duration_minutes,parent_class_id)
      VALUES ('group',$1,'Deutsch A1 Abends V2',$2,'none','scheduled',$3,$4,$5) RETURNING id`,
      [TEACHER, GROUP_V2, m.iso, m.durationMin, parent.id]);
    allIds.push(r.id);
  }
  for (const sid of [LYDIA,NATALIA]) {
    for (const cid of allIds) {
      await c.query(`INSERT INTO class_participants (class_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[cid,sid]);
    }
  }
  await c.query(`UPDATE student_groups SET total_sessions=70 WHERE id=$1`, [GROUP_V2]);
  console.log(`✓ V2: ${allIds.length} reuniones × 100min insertadas (May-Sep, 7/mes)`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación final: re-auditar todos los estudiantes
const { rows } = await c.query(`
  SELECT u.full_name AS student,
         to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS mes,
         COUNT(*)::int AS ses,
         SUM(CASE WHEN c.duration_minutes<15 THEN 0 WHEN c.duration_minutes<=75 THEN 1
                  WHEN c.duration_minutes<=125 THEN 2 WHEN c.duration_minutes<=175 THEN 3
                  ELSE CEIL(c.duration_minutes::numeric/50)::int END)::int AS uds
    FROM class_participants cp
    JOIN classes c ON c.id=cp.class_id
    JOIN students s ON s.id=cp.student_id
    JOIN users u ON u.id=s.user_id
   WHERE c.scheduled_at>='2026-05-01' AND c.status='scheduled'
   GROUP BY u.full_name, to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','YYYY-MM')
   HAVING SUM(CASE WHEN c.duration_minutes<15 THEN 0 WHEN c.duration_minutes<=75 THEN 1
                   WHEN c.duration_minutes<=125 THEN 2 WHEN c.duration_minutes<=175 THEN 3
                   ELSE CEIL(c.duration_minutes::numeric/50)::int END) > 14
   ORDER BY u.full_name, mes`);
console.log("\n══════════ Estudiantes que TODAVÍA exceden 14 uds/mes ══════════");
if (rows.length === 0) console.log("  ✓ NINGUNO");
else for (const x of rows) console.log(`  ⚠ ${x.student?.padEnd(28)} ${x.mes}  ${x.ses} ses · ${x.uds} uds`);

await c.end();
