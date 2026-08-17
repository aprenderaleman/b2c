#!/usr/bin/env node
/**
 * Asigna group_id a las clases de Sabine que se crearon vía aula LiveKit
 * sin asociar al grupo correspondiente. Esto hace que el PDF muestre el
 * nombre del grupo en vez de "—".
 *
 *   - 20-abr 12:41  (on_demand Maria Eugenia)         → grupo Maria Eugenia VIP
 *   - 24-abr 14:00  (individual Maria Eugenia)        → grupo Maria Eugenia VIP
 *   - 27-abr 07:15  ("Grupo (1 alumnos)" Morgens)     → grupo Deutsch A1 – B1 Morgens
 *   - 29-abr 07:00  ("Deutsch A1 – B1 Morgens")       → grupo Deutsch A1 – B1 Morgens
 *   - 29-abr 10:00  (individual Maria Eugenia)        → grupo Maria Eugenia VIP
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

// Buscar group_ids
const { rows: [me]      } = await c.query(`SELECT id FROM student_groups WHERE name = 'Maria Eugenia - Deutsch B1 I Aprender-Aleman.de'`);
const { rows: [morgens] } = await c.query(`SELECT id FROM student_groups WHERE name = 'Deutsch A1 – B1 Morgens'`);
console.log(`  Maria Eugenia VIP group_id: ${me?.id}`);
console.log(`  Morgens group_id:           ${morgens?.id}`);
if (!me || !morgens) throw new Error("grupos no encontrados");

await c.query("BEGIN");
try {
  // Detectar TODAS las clases de Sabine de abril que no tienen group_id
  // y asignar según participantes.
  const { rows: orphans } = await c.query(`
    SELECT cls.id, cls.scheduled_at, cls.type, cls.title,
      json_agg(u.full_name) AS participants
    FROM classes cls
    JOIN class_participants cp ON cp.class_id = cls.id
    JOIN students s ON s.id = cp.student_id
    JOIN users u ON u.id = s.user_id
    JOIN teachers t ON t.id = cls.teacher_id
    JOIN users ut ON ut.id = t.user_id
    WHERE ut.full_name = 'Sabine Arning'
      AND cls.scheduled_at >= '2026-04-01' AND cls.scheduled_at < '2026-05-01'
      AND cls.status = 'completed'
      AND cls.billed_hours > 0
      AND cls.group_id IS NULL
    GROUP BY cls.id, cls.scheduled_at, cls.type, cls.title
    ORDER BY cls.scheduled_at`);

  console.log(`\n  Clases huérfanas (sin group_id): ${orphans.length}`);
  for (const cls of orphans) {
    let groupId = null;
    let groupName = null;
    const parts = cls.participants;

    // Decisión por participantes
    if (parts.length === 1 && parts[0] === "Maria Eugenia") {
      groupId = me.id;
      groupName = "Maria Eugenia VIP";
    } else if (cls.type === "group" && parts.some(p => ["Nicolas Abellan","Javier Esqueta","Victoria"].includes(p))) {
      groupId = morgens.id;
      groupName = "Morgens";
    }

    if (!groupId) {
      console.log(`    ⚠ ${cls.scheduled_at.toISOString().slice(0,16)}  ${cls.title}  parts=${JSON.stringify(parts)}  (no se pudo asignar)`);
      continue;
    }

    await c.query(`UPDATE classes SET group_id = $1 WHERE id = $2`, [groupId, cls.id]);
    console.log(`    ✓ ${cls.scheduled_at.toISOString().slice(0,16)}  ${cls.type}  → ${groupName}`);
  }

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}

await c.end();
