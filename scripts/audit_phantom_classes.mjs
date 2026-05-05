// Detecta participaciones fantasma: filas en class_participants donde
// la clase ocurrió ANTES de que el alumno se uniera al grupo.
// El bug: cuando un alumno se incorpora a un grupo, el script de
// backfill de Zoom le asigna todas las grabaciones históricas del grupo
// como si las hubiera dado.

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

// 1) Detectar fantasmas comparando contra student_group_members.joined_at
const { rows: phantom } = await c.query(`
  SELECT
    cp.student_id,
    s_user.full_name AS student_name,
    s_user.email     AS student_email,
    sg.id            AS group_id,
    sg.name          AS group_name,
    sgm.joined_at    AS member_joined_at,
    COUNT(*)         AS n_phantom_classes,
    MIN(c.scheduled_at) AS earliest_phantom,
    MAX(c.scheduled_at) AS latest_phantom
  FROM class_participants cp
  JOIN classes c           ON c.id = cp.class_id
  JOIN students st         ON st.id = cp.student_id
  JOIN users s_user        ON s_user.id = st.user_id
  JOIN student_group_members sgm
    ON sgm.student_id = cp.student_id AND sgm.group_id = c.group_id
  JOIN student_groups sg   ON sg.id = c.group_id
  WHERE c.scheduled_at < sgm.joined_at
    AND c.is_trial = false
  GROUP BY cp.student_id, s_user.full_name, s_user.email, sg.id, sg.name, sgm.joined_at
  ORDER BY n_phantom_classes DESC, s_user.full_name
`);

console.log(`\n══════════ ALUMNOS CON CLASES FANTASMA (clase ANTES de joined_at) ══════════`);
console.log(`Encontrados ${phantom.length} casos.\n`);

let totalPhantom = 0;
for (const r of phantom) {
  totalPhantom += parseInt(r.n_phantom_classes, 10);
  console.log(
    `  ${(r.student_name||"—").padEnd(28)} | ${(r.student_email||"").padEnd(34)} | ` +
    `joined=${r.member_joined_at.toISOString().slice(0,10)} | ` +
    `${String(r.n_phantom_classes).padStart(3)} fantasma | ` +
    `desde ${r.earliest_phantom.toISOString().slice(0,10)} hasta ${r.latest_phantom.toISOString().slice(0,10)} | ` +
    `grp=${(r.group_name||"—").slice(0,30)}`
  );
}
console.log(`\n  TOTAL filas fantasma a eliminar: ${totalPhantom}`);

// 2) Caso especial: clases SIN group_id pero con title del grupo
//    (como las Nachmittags de Nicolas — group_id=NULL, title="Deutsch A1.2 Nachmittags...")
//    Esas no las pilla la query 1. Las contamos aparte para inspección manual.
console.log(`\n══════════ Backfills MASIVOS sospechosos (created_at = mismo día, varias clases del pasado) ══════════`);
const { rows: bulk } = await c.query(`
  WITH bulk AS (
    SELECT
      cp.student_id,
      date_trunc('day', cp.created_at) AS dia_creacion,
      COUNT(*) FILTER (WHERE c.scheduled_at < cp.created_at - INTERVAL '7 days') AS pasadas,
      MIN(c.scheduled_at) AS earliest,
      MAX(c.scheduled_at) FILTER (WHERE c.scheduled_at < cp.created_at - INTERVAL '7 days') AS latest_past
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
    WHERE c.is_trial = false
    GROUP BY cp.student_id, date_trunc('day', cp.created_at)
    HAVING COUNT(*) FILTER (WHERE c.scheduled_at < cp.created_at - INTERVAL '7 days') >= 5
  )
  SELECT b.*, u.full_name, u.email
    FROM bulk b
    JOIN students st ON st.id = b.student_id
    JOIN users u ON u.id = st.user_id
   ORDER BY pasadas DESC
`);
console.log(`Encontrados ${bulk.length} casos de backfill masivo (≥5 clases pasadas creadas en un solo día).\n`);
for (const r of bulk) {
  console.log(
    `  ${(r.full_name||"—").padEnd(28)} | ${(r.email||"").padEnd(34)} | ` +
    `creadas el ${r.dia_creacion.toISOString().slice(0,10)} | ` +
    `${String(r.pasadas).padStart(3)} clases pasadas | ` +
    `desde ${r.earliest.toISOString().slice(0,10)} hasta ${r.latest_past?.toISOString().slice(0,10) ?? "—"}`
  );
}

await c.end();
