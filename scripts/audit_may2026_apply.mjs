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

const APPLY = process.argv.includes("--apply");
const rows = JSON.parse(fs.readFileSync("C:/Users/gelfi/Desktop/b2c/may2026_audit.json","utf8"));

function unitsFromMinutes(min) {
  if (min < 15) return 0;
  if (min <= 75) return 1;
  if (min <= 125) return 2;
  if (min <= 175) return 3;
  return Math.ceil(min / 50);
}

const decisions = [];
for (const r of rows) {
  if (Number(r.billed_hours) > 0) continue;
  const recMin = r.rec_min || 0;
  const realMin = r.real_min || 0;
  const actMin = r.act || 0;
  const titleLower = (r.title || "").toLowerCase();

  let decision = "INCIERTO", bh = 0, actMinNew = null, confidence = 0, reason = "";

  if (titleLower.includes("reuni")) {
    decision = "NO-CLASE"; reason = "Reunión administrativa"; confidence = 95;
  } else if (recMin >= 30) {
    decision = "DIO";
    actMinNew = recMin > 0 ? Math.max(recMin, actMin) : (actMin || r.plan);
    bh = unitsFromMinutes(actMinNew);
    reason = `recording ${recMin}min confirma clase`; confidence = 95;
  } else if (realMin >= 30) {
    decision = "DIO"; actMinNew = realMin; bh = unitsFromMinutes(realMin);
    reason = `timer ${realMin}min`; confidence = 88;
  } else if (recMin < 15 && r.n_att === 0 && r.n_parts > 0) {
    decision = "NO-SHOW"; actMinNew = 0; bh = 0.5;
    reason = `sin evidencia + alumno no asistió → 50%`; confidence = 80;
  } else if (recMin >= 15 && recMin < 30 && r.n_att === 0) {
    decision = "NO-SHOW"; actMinNew = recMin; bh = 0.5;
    reason = `recording corto ${recMin}min + alumno no asistió → 50%`; confidence = 75;
  } else {
    decision = "INCIERTO"; reason = `sin evidencia clara`; confidence = 0;
  }
  decisions.push({ ...r, decision, bh, actMinNew, reason, confidence });
}

console.log("\n=== DECISIONES ===");
const byD = { DIO: [], "NO-SHOW": [], "NO-CLASE": [], INCIERTO: [] };
for (const d of decisions) byD[d.decision].push(d);
for (const [k, arr] of Object.entries(byD)) {
  console.log(`\n--- ${k} (${arr.length}) ---`);
  for (const d of arr) {
    console.log(` ${d.profe.padEnd(22)} ${d.berlin} ${d.type.padEnd(11)} → bh=${d.bh} (${d.confidence}%) ${d.reason}`);
  }
}

if (!APPLY) {
  console.log("\n[DRY RUN — re-corre con --apply]");
  process.exit(0);
}

(async () => {
  const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  // Rates per teacher
  const tt = await c.query(`
    SELECT t.id::text, u.full_name, t.rate_individual_cents AS ric, t.rate_group_cents AS rgc
      FROM teachers t JOIN users u ON u.id=t.user_id`);
  const rate = {};
  for (const x of tt.rows) rate[x.full_name] = { ric: x.ric, rgc: x.rgc, tid: x.id };

  let applyDIO = 0, applyNoShow = 0;
  const teachersTouched = new Set();
  for (const d of decisions) {
    if (d.decision === "DIO") {
      await c.query(
        `UPDATE classes SET billed_hours=$1, actual_duration_minutes=COALESCE($2, actual_duration_minutes), ended_at = COALESCE(ended_at, scheduled_at + (COALESCE($2, duration_minutes)||' minutes')::interval) WHERE id=$3`,
        [d.bh, d.actMinNew, d.id]);
      applyDIO++;
      teachersTouched.add(d.profe);
    } else if (d.decision === "NO-SHOW") {
      // Manual log entry: half-rate, duration=25min (half academic hour)
      const tInfo = rate[d.profe];
      if (!tInfo) { console.warn("No rate found for", d.profe); continue; }
      const rateCents = d.type === "individual" ? tInfo.ric : tInfo.rgc;
      if (!rateCents) { console.warn("Rate 0 for", d.profe, d.type); continue; }
      const halfAmount = Math.round(rateCents / 2);  // 50%
      // Idempotency: skip if a log already exists
      const ex = await c.query(`SELECT id FROM class_hours_log WHERE class_id=$1`, [d.id]);
      if (ex.rows.length > 0) { console.log(`skip dup ${d.id}`); continue; }
      await c.query(
        `INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency)
         VALUES ($1, $2, 25, $3, $4, 'EUR')`,
        [d.id, tInfo.tid, rateCents/100, halfAmount]);
      // Mark class actual_duration so it's visible
      await c.query(
        `UPDATE classes SET actual_duration_minutes = $1, ended_at = COALESCE(ended_at, scheduled_at + interval '15 minutes') WHERE id = $2`,
        [d.actMinNew || 0, d.id]);
      applyNoShow++;
      teachersTouched.add(d.profe);
    }
  }
  console.log(`\n[APPLY] DIO=${applyDIO}, NO-SHOW=${applyNoShow}`);

  // Recompute teacher_earnings for the month for touched teachers
  for (const profe of teachersTouched) {
    const tid = rate[profe]?.tid;
    if (!tid) continue;
    await c.query(`SELECT recompute_teacher_month($1::uuid, date_trunc('month', NOW())::date)`, [tid]);
  }
  console.log(`[RECOMPUTE] ${teachersTouched.size} profes`);

  await c.end();
})().catch(e=>{console.error("ERR:",e.message);process.exit(1)});
