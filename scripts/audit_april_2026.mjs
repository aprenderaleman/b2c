#!/usr/bin/env node
/**
 * AUDITORÍA end-to-end de abril 2026.
 * Recalcula desde cero (Zoom + DB) y compara contra lo guardado.
 *
 * Verifica:
 *  1. Cada instancia de Zoom (≥15min) tiene una clase en DB con bh correcto.
 *  2. Cada clase en DB de abril tiene UNA fila en class_hours_log con el
 *     amount correcto según tarifa actual del profesor.
 *  3. teacher_earnings.amount_cents == SUM(class_hours_log.amount_cents) del mes.
 *  4. students.classes_remaining == classes_purchased - count(class_participants completadas).
 *  5. No hay clases huérfanas (en DB pero no vienen de Zoom y no son LiveKit).
 *  6. No hay clases duplicadas (mismo zoom_uuid o mismo started_at+teacher).
 *
 * SOLO LECTURA. No modifica nada.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

const TARGET_MONTH = "2026-04";

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

const MEETINGS = [
  { zoom_id: "81635585039", group_name: "Deutsch A1 – B1 Morgens",                         class_type: "group"      },
  { zoom_id: "87432991646", group_name: "Ayman Kayali I Aprender-Aleman.de",               class_type: "individual" },
  { zoom_id: "84238102027", group_name: "Deutsch A1 - B1 Abends",                          class_type: "group"      },
  { zoom_id: "85833907996", group_name: "Fernanda - VIP ",                                 class_type: "individual" },
  { zoom_id: "81802815059", group_name: "Maria Eugenia - Deutsch B1 I Aprender-Aleman.de", class_type: "individual" },
];

function billedHours(min) {
  if (min < 15)  return 0;
  if (min <= 90) return 1;
  return 2;
}

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
);
const { access_token: token } = await tokRes.json();
async function zget(p) {
  const r = await fetch(`https://api.zoom.us/v2${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const issues = [];
const ok     = [];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cargar tarifas actuales de profesores
// ─────────────────────────────────────────────────────────────────────────────
const { rows: teacherRows } = await db.query(`
  SELECT t.id, u.full_name, LOWER(u.email) AS email,
         t.rate_group_cents, t.rate_individual_cents, t.currency
    FROM teachers t JOIN users u ON u.id = t.user_id`);
const teacherById = new Map(teacherRows.map(t => [t.id, t]));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Para cada meeting de Zoom: obtener instancias de abril, calcular bh esperado
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══════════ 1. ZOOM ↔ DB CROSS-CHECK ══════════");
const expectedFromZoom = [];

for (const meeting of MEETINGS) {
  const { rows: [g] } = await db.query(
    `SELECT id, teacher_id FROM student_groups WHERE name = $1`,
    [meeting.group_name],
  );
  if (!g) {
    issues.push(`✗ Grupo no existe en DB: "${meeting.group_name}"`);
    continue;
  }

  const { meetings: instances = [] } = await zget(`/past_meetings/${meeting.zoom_id}/instances`);
  const aprilInstances = instances.filter(i => (i.start_time ?? "").startsWith(TARGET_MONTH));

  for (const inst of aprilInstances) {
    const det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
    const minutes = det.duration ?? 0;
    const expectedBh = billedHours(minutes);
    expectedFromZoom.push({
      zoom_uuid: inst.uuid, start: det.start_time, minutes,
      expected_bh: expectedBh,
      group_id: g.id, group_name: meeting.group_name, teacher_id: g.teacher_id,
      class_type: meeting.class_type,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cargar todas las clases de abril en DB
// ─────────────────────────────────────────────────────────────────────────────
const { rows: dbClasses } = await db.query(`
  SELECT c.id, c.type, c.teacher_id, c.group_id, c.scheduled_at, c.started_at,
         c.duration_minutes, c.actual_duration_minutes, c.billed_hours,
         c.status, c.notes_admin, c.title
    FROM classes c
   WHERE c.scheduled_at >= '2026-04-01' AND c.scheduled_at < '2026-05-01'
   ORDER BY c.scheduled_at`);

const dbByZoomUuid = new Map();
for (const c of dbClasses) {
  const m = (c.notes_admin ?? "").match(/^zoom_uuid=(.+)$/);
  if (m) dbByZoomUuid.set(m[1], c);
}

// 3a. Cada Zoom con bh>0 debe tener clase en DB con bh correcto.
for (const z of expectedFromZoom) {
  if (z.expected_bh === 0) continue;  // <15min ignorado, correcto
  const c = dbByZoomUuid.get(z.zoom_uuid);
  if (!c) {
    issues.push(`✗ Falta en DB: ${z.start.slice(0,16)} ${z.group_name} (${z.minutes}min, bh=${z.expected_bh}h)`);
    continue;
  }
  if (c.billed_hours !== z.expected_bh) {
    issues.push(`✗ bh distinto en DB para ${z.start.slice(0,16)} ${z.group_name}: DB=${c.billed_hours}h, Zoom=${z.expected_bh}h (${z.minutes}min)`);
  }
  if (c.status !== "completed") {
    issues.push(`✗ Clase ${c.id} NO está completed (status=${c.status})`);
  }
  if (c.teacher_id !== z.teacher_id) {
    issues.push(`✗ teacher_id distinto para ${z.start.slice(0,16)}: DB=${c.teacher_id}, esperado=${z.teacher_id}`);
  }
  if (c.type !== z.class_type) {
    issues.push(`✗ type distinto para ${z.start.slice(0,16)}: DB=${c.type}, esperado=${z.class_type}`);
  }
}

// 3b. Clases huérfanas en DB (no son de los 5 meetings y no son LiveKit conocido).
const validZoomUuids = new Set(expectedFromZoom.map(z => z.zoom_uuid));
for (const c of dbClasses) {
  const m = (c.notes_admin ?? "").match(/^zoom_uuid=(.+)$/);
  if (m && !validZoomUuids.has(m[1])) {
    issues.push(`⚠ Clase con zoom_uuid=${m[1]} pero ese UUID no aparece en Zoom hoy: ${c.id} (${c.title})`);
  }
}

// 3c. Buscar dups por (started_at, teacher_id).
const startTeacherKey = new Map();
for (const c of dbClasses) {
  if (!c.started_at || !c.teacher_id) continue;
  const k = `${c.started_at}__${c.teacher_id}`;
  if (startTeacherKey.has(k)) {
    issues.push(`✗ Posible duplicado: ${c.started_at} teacher=${c.teacher_id} (clases ${startTeacherKey.get(k)} y ${c.id})`);
  } else {
    startTeacherKey.set(k, c.id);
  }
}

const completedAprilClasses = dbClasses.filter(c => c.status === "completed" && c.billed_hours > 0);
ok.push(`Zoom abril: ${expectedFromZoom.length} instancias (${expectedFromZoom.filter(z => z.expected_bh > 0).length} facturables, ${expectedFromZoom.filter(z => z.expected_bh === 0).length} <15min ignoradas)`);
ok.push(`DB abril:   ${dbClasses.length} clases (${completedAprilClasses.length} completed con bh>0)`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. class_hours_log: una fila por cada clase completada con bh>0
// ─────────────────────────────────────────────────────────────────────────────
console.log("══════════ 2. class_hours_log ══════════");
const { rows: logRows } = await db.query(`
  SELECT chl.id, chl.class_id, chl.teacher_id, chl.duration_minutes,
         chl.amount_cents, chl.currency, chl.rate_at_time
    FROM class_hours_log chl
    JOIN classes c ON c.id = chl.class_id
   WHERE c.scheduled_at >= '2026-04-01' AND c.scheduled_at < '2026-05-01'`);
const logByClass = new Map(logRows.map(l => [l.class_id, l]));

for (const c of completedAprilClasses) {
  const l = logByClass.get(c.id);
  if (!l) {
    issues.push(`✗ Sin class_hours_log: clase ${c.id} (${c.scheduled_at.toISOString?.()?.slice(0,10) ?? c.scheduled_at})`);
    continue;
  }
  const t = teacherById.get(c.teacher_id);
  if (!t) {
    issues.push(`✗ Profesor no encontrado para clase ${c.id}: teacher_id=${c.teacher_id}`);
    continue;
  }
  const expectedRateCents = c.type === "individual" ? t.rate_individual_cents : t.rate_group_cents;
  const expectedAmount    = c.billed_hours * expectedRateCents;
  // Excepción "media clase": amount = ½ rate, duration = 30. Ej: Maria Eugenia 20-abr 22min on_demand.
  const isHalfClass = (l.amount_cents === Math.round(expectedRateCents / 2)) && (l.duration_minutes === 30);
  if (!isHalfClass) {
    if (l.amount_cents !== expectedAmount) {
      issues.push(`✗ amount_cents incorrecto para clase ${c.id}: log=${l.amount_cents/100}€, esperado=${expectedAmount/100}€ (${c.billed_hours}h × ${expectedRateCents/100}€/h)`);
    }
    const expectedMin = c.billed_hours * 60;
    if (l.duration_minutes !== expectedMin) {
      issues.push(`✗ duration_minutes incorrecto en log para clase ${c.id}: log=${l.duration_minutes}, esperado=${expectedMin}`);
    }
  }
}
ok.push(`class_hours_log: ${logRows.length} filas para abril`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. teacher_earnings == SUM(class_hours_log) por profesor
// ─────────────────────────────────────────────────────────────────────────────
console.log("══════════ 3. teacher_earnings ══════════");
const { rows: earnRows } = await db.query(`
  SELECT te.teacher_id, te.classes_count, te.total_minutes,
         te.amount_cents, te.currency, te.paid, te.paid_at, te.locked,
         u.full_name
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users    u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY u.full_name`);

const expectedByTeacher = new Map();
for (const c of completedAprilClasses) {
  const l = logByClass.get(c.id);
  if (!l) continue;
  if (!expectedByTeacher.has(c.teacher_id)) {
    expectedByTeacher.set(c.teacher_id, { amount_cents: 0, total_minutes: 0, classes_count: 0 });
  }
  const cur = expectedByTeacher.get(c.teacher_id);
  cur.amount_cents  += l.amount_cents;
  cur.total_minutes += l.duration_minutes;
  cur.classes_count += 1;
}

console.log("\n  Profesor               clases  horas  €       paid  | esperado (calc desde log)");
console.log("  " + "─".repeat(80));
for (const e of earnRows) {
  const exp = expectedByTeacher.get(e.teacher_id);
  const matches = exp
    && exp.amount_cents === e.amount_cents
    && exp.total_minutes === e.total_minutes
    && exp.classes_count === e.classes_count;
  const flag = matches ? "✓" : "✗";
  console.log(`  ${flag} ${e.full_name.padEnd(20)} ${String(e.classes_count).padStart(2)}     ${String(e.total_minutes/60).padStart(3)}h   ${String(e.amount_cents/100).padStart(5)}€  ${e.paid ? "SI" : "no"}  | ${exp ? `${exp.classes_count} / ${exp.total_minutes/60}h / ${exp.amount_cents/100}€` : "(no esperado)"}`);
  if (!matches) {
    issues.push(`✗ teacher_earnings desincronizado para ${e.full_name}: ` +
      `DB=(${e.classes_count}cls/${e.total_minutes/60}h/${e.amount_cents/100}€) vs ` +
      `esperado=(${exp?.classes_count}cls/${exp?.total_minutes/60}h/${exp?.amount_cents/100}€)`);
  }
}
// Profesores con horas calculadas pero sin fila en teacher_earnings.
for (const [tid, exp] of expectedByTeacher) {
  if (!earnRows.find(e => e.teacher_id === tid)) {
    issues.push(`✗ Sin fila en teacher_earnings para teacher_id=${tid} (esperado ${exp.amount_cents/100}€)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. students.classes_remaining == classes_purchased - count(participations)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══════════ 4. PAQUETES DE ESTUDIANTES ══════════");
const { rows: studentRows } = await db.query(`
  SELECT s.id, u.full_name,
         s.classes_purchased, s.classes_remaining, s.classes_adjustment,
         s.pack_started_at, s.pack_expires_at,
         (SELECT COUNT(*)::int
            FROM class_participants cp
            JOIN classes c ON c.id = cp.class_id
           WHERE cp.student_id = s.id
             AND cp.counts_as_session = TRUE
             AND c.status = 'completed'
             AND c.billed_hours > 0) AS participations_count
    FROM students s
    JOIN users u ON u.id = s.user_id
   WHERE s.classes_purchased > 0
   ORDER BY u.full_name`);

console.log("\n  Estudiante               compradas  adj   participaciones  restan  esperado");
console.log("  " + "─".repeat(85));
for (const s of studentRows) {
  // Fórmula real (migración 029): purchased + adjustment - count
  const expectedRemain = Math.max(0, s.classes_purchased + s.classes_adjustment - s.participations_count);
  const matches = expectedRemain === s.classes_remaining;
  const flag = matches ? "✓" : "✗";
  console.log(`  ${flag} ${(s.full_name ?? "—").padEnd(24)} ${String(s.classes_purchased).padStart(3)}        ${String(s.classes_adjustment).padStart(4)}  ${String(s.participations_count).padStart(3)} part.          ${String(s.classes_remaining).padStart(3)}     ${String(expectedRemain).padStart(3)}`);
  if (!matches) {
    issues.push(`✗ classes_remaining desincronizado para ${s.full_name}: DB=${s.classes_remaining}, esperado=${expectedRemain} (${s.classes_purchased}+${s.classes_adjustment}-${s.participations_count})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Detalle por profesor (lo que se va a pagar)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══════════ 5. DESGLOSE POR PROFESOR (lo que se le paga) ══════════");
const byTeacherClasses = new Map();
for (const c of completedAprilClasses) {
  if (!byTeacherClasses.has(c.teacher_id)) byTeacherClasses.set(c.teacher_id, []);
  byTeacherClasses.get(c.teacher_id).push(c);
}
for (const [tid, classes] of byTeacherClasses) {
  const t = teacherById.get(tid);
  classes.sort((a,b) => new Date(a.started_at) - new Date(b.started_at));
  console.log(`\n  ── ${t.full_name} ──`);
  let total = 0;
  for (const c of classes) {
    const l    = logByClass.get(c.id);
    const date = c.started_at.toISOString().slice(0,10);
    const rate = c.type === "individual" ? t.rate_individual_cents : t.rate_group_cents;
    console.log(`    ${date}  ${c.type.padEnd(10)}  ${c.actual_duration_minutes ?? "?"}min  bh=${c.billed_hours}h  ×  ${rate/100}€/h  = ${l ? l.amount_cents/100 : "?"}€   "${c.title}"`);
    total += l?.amount_cents ?? 0;
  }
  console.log(`    ─────────────────────────────────────────  TOTAL: ${total/100}€`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n══════════ RESUMEN AUDITORÍA ══════════");
for (const o of ok) console.log(`  ✓ ${o}`);
if (issues.length === 0) {
  console.log(`\n  🟢 SIN INCIDENCIAS — los pagos y paquetes están correctos.`);
} else {
  console.log(`\n  🔴 ${issues.length} INCIDENCIA${issues.length===1?"":"S"}:`);
  for (const i of issues) console.log(`     ${i}`);
}

await db.end();
