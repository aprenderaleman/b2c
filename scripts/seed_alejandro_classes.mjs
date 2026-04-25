#!/usr/bin/env node
/**
 * Alejandro ↔ Sabine: one-shot bootstrap.
 *   1. Make sure Sabine is the assigned teacher of Alejandro's group.
 *   2. Create the Saturday 2026-04-25 10:30-11:30 one-off class.
 *   3. Create 12 weekly Tuesday classes, 2026-04-28 → 2026-07-14,
 *      17:00-19:00 Berlin, linked by parent_class_id so edits to the
 *      series are easy.
 *   4. Attach Alejandro as participant + counts_as_session=true.
 *
 * Idempotent: re-running it skips rows that already exist by
 * (teacher_id, scheduled_at).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __d = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__d, ".."), ".env");
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
await db.query("BEGIN");

try {
  // ── 1. Resolve IDs
  const { rows: [sabine] } = await db.query(
    `SELECT t.id AS teacher_id FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE LOWER(u.email) = 'coyotemoonyoga@gmail.com'`);
  if (!sabine) throw new Error("Sabine not found");

  const { rows: [alejandro] } = await db.query(
    `SELECT s.id AS student_id, u.id AS user_id
       FROM students s JOIN users u ON u.id = s.user_id
      WHERE LOWER(u.email) = 'xela_cigales@hotmail.es'`);
  if (!alejandro) throw new Error("Alejandro not found");

  const { rows: [group] } = await db.query(
    `SELECT id, teacher_id FROM student_groups
      WHERE name ILIKE 'Alejandro%Sanz%Deutsch B1%' LIMIT 1`);
  if (!group) throw new Error("Alejandro group not found");

  console.log(`Sabine teacher_id = ${sabine.teacher_id}`);
  console.log(`Alejandro student_id = ${alejandro.student_id}`);
  console.log(`Group id = ${group.id}  (current teacher_id=${group.teacher_id ?? "NULL"})`);

  // ── 2. Assign Sabine as the group's teacher (if not already)
  if (group.teacher_id !== sabine.teacher_id) {
    await db.query(
      `UPDATE student_groups SET teacher_id = $1 WHERE id = $2`,
      [sabine.teacher_id, group.id]);
    console.log(`✓ Group teacher set → Sabine`);
  } else {
    console.log(`= Group teacher already Sabine`);
  }

  // ── 3. Saturday one-off: 2026-04-25 10:30 Berlin = 08:30 UTC (CEST)
  const saturday = new Date("2026-04-25T08:30:00Z");
  await insertClass({
    db,
    teacher_id: sabine.teacher_id,
    group_id:   group.id,
    scheduled_at: saturday,
    duration_minutes: 60,
    title: "Alejandro — Clase individual",
    topic: "Deutsch B1",
    parent_class_id: null,
    recurrence_pattern: "none",
  });

  // ── 4. Recurring Tuesdays 17:00-19:00 Berlin = 15:00 UTC (CEST)
  //     Start 2026-04-28, 12 weeks → ends 2026-07-14.
  const firstTuesday = new Date("2026-04-28T15:00:00Z");
  let parentId = null;
  for (let i = 0; i < 12; i++) {
    const when = new Date(firstTuesday.getTime() + i * 7 * 24 * 3600 * 1000);
    const id = await insertClass({
      db,
      teacher_id: sabine.teacher_id,
      group_id:   group.id,
      scheduled_at: when,
      duration_minutes: 120,
      title: "Alejandro — Clase individual",
      topic: "Deutsch B1",
      parent_class_id: parentId,
      recurrence_pattern: i === 0 ? "weekly" : "none",
      recurrence_end_date: i === 0 ? new Date("2026-07-14") : null,
    });
    if (i === 0) parentId = id;
    // Also point the first back at itself to match the admin modal convention.
    if (i === 0 && id) {
      await db.query(`UPDATE classes SET parent_class_id = id WHERE id = $1`, [id]);
    }
  }

  // ── 5. Attach Alejandro to every class we just touched (idempotent).
  await db.query(
    `INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
     SELECT c.id, $1, NULL, TRUE
       FROM classes c
      WHERE c.teacher_id = $2
        AND c.group_id   = $3
        AND c.status     = 'scheduled'
        AND NOT EXISTS (
          SELECT 1 FROM class_participants cp
           WHERE cp.class_id = c.id AND cp.student_id = $1
        )`,
    [alejandro.student_id, sabine.teacher_id, group.id]);

  await db.query("COMMIT");

  // ── Verification
  const { rows: upcoming } = await db.query(
    `SELECT id, scheduled_at, duration_minutes, title
       FROM classes
      WHERE teacher_id = $1 AND group_id = $2 AND status = 'scheduled'
      ORDER BY scheduled_at ASC`,
    [sabine.teacher_id, group.id]);
  console.log(`\n✓ Classes now scheduled for Alejandro + Sabine: ${upcoming.length}`);
  for (const c of upcoming.slice(0, 15)) {
    console.log(`   ${c.scheduled_at.toISOString().slice(0,16)} · ${c.duration_minutes}min · ${c.title}`);
  }
} catch (e) {
  await db.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exit(1);
}

await db.end();

async function insertClass({
  db, teacher_id, group_id, scheduled_at, duration_minutes, title, topic,
  parent_class_id, recurrence_pattern, recurrence_end_date,
}) {
  // idempotency: skip if a class exists for (teacher, scheduled_at)
  const { rows: existing } = await db.query(
    `SELECT id FROM classes WHERE teacher_id = $1 AND scheduled_at = $2 LIMIT 1`,
    [teacher_id, scheduled_at],
  );
  if (existing.length > 0) {
    console.log(`= already exists ${scheduled_at.toISOString().slice(0,16)}`);
    return existing[0].id;
  }
  const { rows: [ins] } = await db.query(
    `INSERT INTO classes (type, teacher_id, group_id, scheduled_at, duration_minutes,
                          title, topic, status, recurrence_pattern, recurrence_end_date,
                          parent_class_id, notes_admin)
     VALUES ('individual', $1, $2, $3, $4, $5, $6, 'scheduled', $7::recurrence_pattern, $8,
             $9, 'alejandro_seed')
     RETURNING id`,
    [teacher_id, group_id, scheduled_at, duration_minutes, title, topic,
     recurrence_pattern, recurrence_end_date, parent_class_id],
  );
  console.log(`+ ${scheduled_at.toISOString().slice(0,16)} · ${duration_minutes}min`);
  return ins.id;
}
