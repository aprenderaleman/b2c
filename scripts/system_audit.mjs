#!/usr/bin/env node
/**
 * System-wide sanity audit. Runs ~40 checks against Supabase and reports
 * every anomaly. Read-only — no writes. Returns exit code 1 if any check
 * flags an error so it can run in CI.
 *
 * Output shape per check:
 *   [ OK   ] label — details
 *   [ WARN ] label — details
 *   [ FAIL ] label — details
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(path.resolve(__dirname, ".."), ".env");
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

let ok = 0, warn = 0, fail = 0;
const findings = [];
function record(level, label, detail) {
  const line = `[${level.padEnd(4)}] ${label}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  findings.push({ level, label, detail });
  if (level === "OK")   ok++;
  if (level === "WARN") warn++;
  if (level === "FAIL") fail++;
}
async function check(label, fn) {
  try { await fn(); }
  catch (e) { record("FAIL", label, `uncaught: ${e.message}`); }
}
async function q(sql, params=[]) {
  const r = await db.query(sql, params);
  return r.rows;
}

// ════════════════════════════════════════════════════════════════════════
// 1. DATA INTEGRITY — orphans, duplicates, broken FKs
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 1. INTEGRIDAD DE DATOS ═══");

await check("users sin student ni teacher ni admin role válido", async () => {
  const r = await q(`SELECT COUNT(*)::int AS n FROM users WHERE role NOT IN ('superadmin','admin','teacher','student')`);
  if (r[0].n > 0) record("FAIL", "users con role inválido", `${r[0].n} filas`);
  else record("OK", "users con roles válidos", "todos los roles bien");
});

await check("teachers huérfanos (sin user)", async () => {
  const r = await q(`SELECT t.id FROM teachers t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL`);
  if (r.length > 0) record("FAIL", "teachers huérfanos", `${r.length} filas`);
  else record("OK", "teachers sin usuario huérfano", "todos linkeados");
});

await check("students huérfanos", async () => {
  const r = await q(`SELECT s.id FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL`);
  if (r.length > 0) record("FAIL", "students huérfanos", `${r.length} filas`);
  else record("OK", "students sin usuario huérfano", "todos linkeados");
});

await check("students.classes_remaining nunca negativo", async () => {
  const r = await q(`SELECT id, classes_remaining FROM students WHERE classes_remaining < 0`);
  if (r.length > 0) record("FAIL", "classes_remaining negativo", `${r.length} estudiantes`);
  else record("OK", "classes_remaining >= 0", "en todos los estudiantes");
});

await check("students.classes_remaining <= classes_purchased", async () => {
  const r = await q(`SELECT id, classes_remaining, classes_purchased FROM students WHERE classes_remaining > classes_purchased`);
  if (r.length > 0) record("FAIL", "classes_remaining > purchased", `${r.length} casos`);
  else record("OK", "remaining dentro del límite purchased", "");
});

await check("student_group_members referencian grupos existentes", async () => {
  const r = await q(`SELECT m.group_id FROM student_group_members m LEFT JOIN student_groups sg ON sg.id = m.group_id WHERE sg.id IS NULL`);
  if (r.length > 0) record("FAIL", "memberships huérfanas", `${r.length} filas`);
  else record("OK", "memberships ok", "");
});

await check("classes con teacher_id apuntando a teacher inexistente", async () => {
  const r = await q(`SELECT c.id FROM classes c LEFT JOIN teachers t ON t.id = c.teacher_id WHERE c.teacher_id IS NOT NULL AND t.id IS NULL`);
  if (r.length > 0) record("FAIL", "classes con teacher fantasma", `${r.length} clases`);
  else record("OK", "classes.teacher_id válidos", "");
});

await check("class_participants de clases existentes", async () => {
  const r = await q(`SELECT cp.class_id FROM class_participants cp LEFT JOIN classes c ON c.id = cp.class_id WHERE c.id IS NULL`);
  if (r.length > 0) record("FAIL", "class_participants huérfanos", `${r.length} filas`);
  else record("OK", "class_participants válidos", "");
});

await check("emails únicos (insensible a mayúsculas)", async () => {
  const r = await q(`SELECT LOWER(email) AS e, COUNT(*)::int AS n FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1`);
  if (r.length > 0) record("FAIL", "emails duplicados", r.map(x => x.e).join(", "));
  else record("OK", "emails únicos", "");
});

// ════════════════════════════════════════════════════════════════════════
// 2. INVARIANTES DE NEGOCIO — packs, earnings
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 2. INVARIANTES DE NEGOCIO ═══");

await check("v_student_packs match students.classes_remaining (triggers en sync)", async () => {
  const r = await q(`
    SELECT s.id, u.full_name, s.classes_remaining AS stored, vsp.classes_remaining AS view_value
      FROM students s JOIN users u ON u.id = s.user_id
      JOIN v_student_packs vsp ON vsp.student_id = s.id
     WHERE s.classes_remaining <> vsp.classes_remaining`);
  if (r.length > 0) record("FAIL", "trigger classes_remaining desincronizado",
    r.map(x => `${x.full_name}: stored=${x.stored} view=${x.view_value}`).join(", "));
  else record("OK", "classes_remaining siempre cuadra con v_student_packs", "");
});

await check("teacher_earnings.amount_cents == SUM(class_hours_log) por (teacher, month)", async () => {
  const r = await q(`
    SELECT te.teacher_id, te.month, te.amount_cents AS stored,
           COALESCE(SUM(chl.amount_cents), 0) AS from_log
      FROM teacher_earnings te
      LEFT JOIN class_hours_log chl
        ON chl.teacher_id = te.teacher_id
       AND DATE_TRUNC('month', chl.created_at) = te.month
     GROUP BY te.teacher_id, te.month, te.amount_cents
    HAVING te.amount_cents <> COALESCE(SUM(chl.amount_cents), 0)`);
  if (r.length > 0) record("FAIL", "teacher_earnings desincronizado",
    `${r.length} filas con mismatch`);
  else record("OK", "teacher_earnings cuadra con class_hours_log", "");
});

await check("classes completadas con billed_hours > 0 tienen class_hours_log", async () => {
  const r = await q(`
    SELECT c.id FROM classes c
     WHERE c.status = 'completed' AND c.billed_hours > 0
       AND c.teacher_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM class_hours_log chl WHERE chl.class_id = c.id)`);
  if (r.length > 0) record("FAIL", "clases completadas sin entry en class_hours_log", `${r.length} clases`);
  else record("OK", "todas las clases billed tienen hours_log", "");
});

await check("class_hours_log.amount_cents consistente con rate * billed_hours", async () => {
  const r = await q(`
    SELECT chl.id, chl.amount_cents AS stored,
           (chl.rate_at_time * chl.duration_minutes / 60 * 100)::int AS computed
      FROM class_hours_log chl
     WHERE ABS(chl.amount_cents - (chl.rate_at_time * chl.duration_minutes / 60 * 100)::int) > 1`);
  if (r.length > 0) record("WARN", "class_hours_log amount no cuadra con rate*hours",
    `${r.length} rows (diff > 1 cent)`);
  else record("OK", "class_hours_log amounts consistentes", "");
});

await check("clases 'scheduled' en el pasado (deberían estar completed/cancelled)", async () => {
  const r = await q(`
    SELECT id, title, scheduled_at FROM classes
     WHERE status = 'scheduled'
       AND scheduled_at < NOW() - INTERVAL '2 hours'
       AND id NOT IN (SELECT id FROM classes WHERE status IN ('completed', 'cancelled'))
     ORDER BY scheduled_at DESC
     LIMIT 10`);
  if (r.length > 0) record("WARN", `clases scheduled atrasadas >2h`,
    `${r.length} clases · ej: ${r[0].title.slice(0,30)} ${r[0].scheduled_at}`);
  else record("OK", "no hay clases scheduled atrasadas", "");
});

await check("clases 'live' sin started_at o con started_at en el pasado >3h", async () => {
  const r = await q(`
    SELECT id, title, started_at FROM classes
     WHERE status = 'live'
       AND (started_at IS NULL OR started_at < NOW() - INTERVAL '3 hours')`);
  if (r.length > 0) record("FAIL", "clases live colgadas", `${r.length} clases (deberían ser completed)`);
  else record("OK", "no hay clases live colgadas", "");
});

// ════════════════════════════════════════════════════════════════════════
// 3. AUTORIZACIÓN / RLS / CONSTRAINTS
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 3. AUTORIZACIÓN / RLS ═══");

await check("RLS habilitado en tablas sensibles", async () => {
  const expected = ["users","teachers","students","classes","class_participants",
                    "class_hours_log","teacher_earnings","teacher_payouts",
                    "student_groups","student_group_members","payments"];
  const r = await q(`
    SELECT tablename, rowsecurity
      FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [expected]);
  const missing = r.filter(x => !x.rowsecurity).map(x => x.tablename);
  if (missing.length > 0) record("FAIL", "RLS NO habilitado en", missing.join(", "));
  else record("OK", "RLS habilitado en todas las tablas críticas", `${r.length} tablas`);
});

await check("política service_role existe en tablas críticas", async () => {
  const r = await q(`
    SELECT tablename, COUNT(*) AS policies
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('users','teachers','students','classes','class_participants',
                         'teacher_earnings','student_groups')
     GROUP BY tablename`);
  const noPolicies = r.filter(x => x.policies === '0').map(x => x.tablename);
  if (noPolicies.length > 0) record("WARN", "tablas sin policies", noPolicies.join(", "));
  else record("OK", "policies presentes en tablas críticas", `${r.length} tablas`);
});

await check("constraint: users.email en lower-case", async () => {
  const r = await q(`SELECT id, email FROM users WHERE email <> LOWER(email)`);
  if (r.length > 0) record("FAIL", "emails con mayúsculas", `${r.length} usuarios`);
  else record("OK", "todos los emails lowercase", "");
});

// ════════════════════════════════════════════════════════════════════════
// 4. LIFECYCLE DE CLASES
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 4. LIFECYCLE DE CLASES ═══");

await check("classes scheduled futuras tienen participantes asignados", async () => {
  const r = await q(`
    SELECT c.id, c.title, c.scheduled_at FROM classes c
     WHERE c.status = 'scheduled' AND c.scheduled_at > NOW()
       AND NOT EXISTS (SELECT 1 FROM class_participants cp WHERE cp.class_id = c.id)
     LIMIT 10`);
  if (r.length > 0) record("WARN", "clases futuras sin alumnos",
    `${r.length} clases — ej ${r[0].title}`);
  else record("OK", "todas las clases futuras tienen alumnos", "");
});

await check("classes.billed_hours coherente con actual_duration_minutes", async () => {
  const r = await q(`
    SELECT id, title, billed_hours, actual_duration_minutes FROM classes
     WHERE status = 'completed' AND actual_duration_minutes IS NOT NULL
       AND (
         (actual_duration_minutes < 45  AND billed_hours > 0) OR
         (actual_duration_minutes BETWEEN 45 AND 90 AND billed_hours <> 1) OR
         (actual_duration_minutes > 90  AND billed_hours <> 2)
       )
     LIMIT 10`);
  if (r.length > 0) record("WARN", "billed_hours no coincide con duración",
    `${r.length} clases · ${r.map(x => `${x.actual_duration_minutes}min→${x.billed_hours}h`).join(", ")}`);
  else record("OK", "billed_hours consistente con duración", "");
});

await check("clases con >1 teacher (nunca debería pasar)", async () => {
  // Esto no debería poder pasar por esquema, pero por si acaso
  const r = await q(`SELECT id, teacher_id FROM classes GROUP BY id, teacher_id HAVING COUNT(*) > 1`);
  if (r.length > 0) record("FAIL", "clases con múltiples teachers?", `${r.length}`);
  else record("OK", "cada clase tiene un solo teacher (o NULL)", "");
});

await check("individual classes con >1 participante (inconsistencia de tipo)", async () => {
  const r = await q(`
    SELECT c.id, c.title, COUNT(cp.*) AS participants
      FROM classes c JOIN class_participants cp ON cp.class_id = c.id
     WHERE c.type = 'individual'
     GROUP BY c.id, c.title
     HAVING COUNT(cp.*) > 1`);
  if (r.length > 0) record("WARN", "clases 'individual' con múltiples alumnos",
    r.slice(0,3).map(x => `${x.title}(${x.participants})`).join(", "));
  else record("OK", "individual classes = 1 alumno", "");
});

// ════════════════════════════════════════════════════════════════════════
// 5. CONTEOS + ESTADÍSTICAS
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 5. ESTADÍSTICAS GENERALES ═══");

const stats = await q(`
  SELECT
    (SELECT COUNT(*) FROM users WHERE active=TRUE AND role='student')           AS active_students,
    (SELECT COUNT(*) FROM users WHERE active=TRUE AND role='teacher')           AS active_teachers,
    (SELECT COUNT(*) FROM student_groups WHERE active=TRUE)                      AS active_groups,
    (SELECT COUNT(*) FROM classes WHERE status='scheduled' AND scheduled_at>NOW()) AS upcoming_classes,
    (SELECT COUNT(*) FROM classes WHERE status='completed')                      AS completed_classes,
    (SELECT COUNT(*) FROM class_hours_log)                                       AS hours_log_rows,
    (SELECT SUM(amount_cents) FROM teacher_earnings WHERE paid = FALSE)/100     AS pending_payouts_eur`);
record("OK", "conteos", JSON.stringify(stats[0]));

// Classes per group sanity
const perGroup = await q(`
  SELECT sg.name,
         (SELECT COUNT(*) FROM student_group_members m WHERE m.group_id = sg.id) AS members,
         (SELECT COUNT(*) FROM classes c WHERE c.group_id = sg.id AND c.status='scheduled' AND c.scheduled_at > NOW()) AS future,
         (SELECT COUNT(*) FROM classes c WHERE c.group_id = sg.id AND c.status='completed') AS past
    FROM student_groups sg
   WHERE sg.active = TRUE
   ORDER BY sg.name`);
for (const g of perGroup) {
  const msg = `members=${g.members} future=${g.future} past=${g.past}`;
  if (g.members === '0') {
    record("WARN", `grupo "${g.name.slice(0,40)}"`, "sin miembros");
  } else if (g.future === '0' && g.past === '0') {
    record("WARN", `grupo "${g.name.slice(0,40)}"`, `${g.members} miembros pero sin clases`);
  } else {
    record("OK", `grupo "${g.name.slice(0,40)}"`, msg);
  }
}

// ════════════════════════════════════════════════════════════════════════
// 6. TIME / TZ SANITY
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 6. TZ / FECHAS ═══");

await check("classes con scheduled_at en año 2026 (no hemos regresado en el tiempo)", async () => {
  const r = await q(`
    SELECT COUNT(*)::int AS n FROM classes
     WHERE scheduled_at < '2025-01-01' OR scheduled_at > '2028-01-01'`);
  if (r[0].n > 0) record("WARN", "classes con scheduled_at fuera de rango razonable",
    `${r[0].n} casos`);
  else record("OK", "scheduled_at dentro de 2025-2028", "");
});

await check("pack_expires_at exactamente 6 meses después de pack_started_at", async () => {
  const r = await q(`
    SELECT id, pack_started_at, pack_expires_at
      FROM students
     WHERE pack_started_at IS NOT NULL
       AND pack_expires_at <> (pack_started_at + INTERVAL '6 months')::date`);
  if (r.length > 0) record("WARN", "pack_expires_at no es exactamente +6 meses",
    `${r.length} casos`);
  else record("OK", "pack_expires_at = pack_started_at + 6m siempre", "");
});

// ════════════════════════════════════════════════════════════════════════
// 7. SALUD DE INFRA
// ════════════════════════════════════════════════════════════════════════
console.log("\n═══ 7. INFRA ═══");

const hb = await q(`
  SELECT service, EXTRACT(EPOCH FROM (NOW() - last_tick))/60 AS minutes_ago
    FROM system_heartbeat`);
for (const h of hb) {
  const m = Number(h.minutes_ago);
  if (m > 30) record("FAIL", `heartbeat ${h.service}`, `${m.toFixed(1)}m stale`);
  else if (m > 15) record("WARN", `heartbeat ${h.service}`, `${m.toFixed(1)}m stale`);
  else record("OK", `heartbeat ${h.service}`, `${m.toFixed(1)}m`);
}

const cfg = await q(`SELECT value FROM system_config WHERE key = 'last_critical_issue'`);
if (cfg[0]?.value) record("FAIL", "critical banner no vacío", cfg[0].value);
else record("OK", "critical banner vacío", "");

// ════════════════════════════════════════════════════════════════════════
// RESUMEN
// ════════════════════════════════════════════════════════════════════════
console.log(`\n═══ RESUMEN ═══`);
console.log(`  OK:   ${ok}`);
console.log(`  WARN: ${warn}`);
console.log(`  FAIL: ${fail}`);

await db.end();
process.exit(fail > 0 ? 1 : 0);
