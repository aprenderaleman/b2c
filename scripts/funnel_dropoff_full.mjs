// Drop-off del funnel — pasos que sí tenemos persistidos.
// Limitación: pasos 2-4 (nivel/goal/urgency/budget) son client-side only
// hasta que llegan al paso 5, así que NO sabemos cuántos abandonan entre
// cada pregunta intermedia. Lo que sí tenemos:
//   paso 1 (motivo) → paso 5 (registered) → paso 6 (trial agendada) →
//   asistencia → conversión.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

const DAYS = 30;
console.log(`\n══════ EMBUDO COMPLETO — últimos ${DAYS} días ══════\n`);

const step1 = +(await db.query(`SELECT count(*) FROM lead_motivo_inicial WHERE created_at >= now() - interval '${DAYS} days'`)).rows[0].count;

const step5 = +(await db.query(`SELECT count(*) FROM leads WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico'`)).rows[0].count;

const step6 = +(await db.query(`
  SELECT count(*) FROM leads
  WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico'
    AND trial_scheduled_at IS NOT NULL
`)).rows[0].count;

// "Asistió" = agendó pero no terminó en trial_absent o absent_followup_*
const attended = +(await db.query(`
  SELECT count(*) FROM leads
  WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico'
    AND trial_scheduled_at IS NOT NULL
    AND status NOT IN ('trial_absent','absent_followup_1','absent_followup_2','absent_followup_3')
`)).rows[0].count;

const converted = +(await db.query(`
  SELECT count(*) FROM leads
  WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico' AND status='converted'
`)).rows[0].count;

const fmt = (n, prev) => {
  if (prev === null || prev === 0) return "";
  const pct = (100 * n / prev).toFixed(1);
  const drop = (100 * (prev - n) / prev).toFixed(1);
  const arrow = drop > 50 ? "🔴" : drop > 25 ? "🟡" : "🟢";
  return `${arrow} ${pct}% pasa · ${drop}% abandona (perdimos ${prev - n})`;
};

console.log("Paso                                            Leads    Conversión vs paso anterior");
console.log("─".repeat(95));
console.log(`1. Click motivo                                  ${String(step1).padStart(5)}    (entrada del embudo)`);
console.log(`2-4. Quiz (nivel/goal/urgency/budget)              ?      🚫 sin telemetría persistida`);
console.log(`5. Datos completados (lead creado)               ${String(step5).padStart(5)}    ${fmt(step5, step1)}`);
console.log(`6. Agendó clase de prueba                        ${String(step6).padStart(5)}    ${fmt(step6, step5)}`);
console.log(`7. Asistió a la clase de prueba                  ${String(attended).padStart(5)}    ${fmt(attended, step6)}`);
console.log(`8. Convirtió (pagó/se inscribió)                 ${String(converted).padStart(5)}    ${fmt(converted, attended)}`);

console.log("\n──── CASCADA % vs entrada paso 1 ────");
if (step1 > 0) {
  const pct = (n) => (100*n/step1).toFixed(2) + "%";
  console.log(`  paso 1 → paso 5:    ${pct(step5)}`);
  console.log(`  paso 1 → paso 6:    ${pct(step6)}`);
  console.log(`  paso 1 → atendió:   ${pct(attended)}`);
  console.log(`  paso 1 → convirtió: ${pct(converted)}`);
}

console.log("\n══════ POR MOTIVO (drop-off entre pasos) ══════");
const perMot = await db.query(`
  WITH s AS (
    SELECT motivo, count(*) AS n FROM lead_motivo_inicial
    WHERE created_at >= now() - interval '${DAYS} days' GROUP BY motivo
  ),
  r AS (
    SELECT motivo_inicial AS motivo, count(*) AS n FROM leads
    WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico' GROUP BY motivo_inicial
  ),
  sc AS (
    SELECT motivo_inicial AS motivo, count(*) AS n FROM leads
    WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico'
      AND trial_scheduled_at IS NOT NULL GROUP BY motivo_inicial
  ),
  cv AS (
    SELECT motivo_inicial AS motivo, count(*) AS n FROM leads
    WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico'
      AND status='converted' GROUP BY motivo_inicial
  )
  SELECT s.motivo, s.n AS sessions,
         coalesce(r.n,0) AS registered,
         coalesce(sc.n,0) AS scheduled,
         coalesce(cv.n,0) AS converted
  FROM s LEFT JOIN r USING(motivo) LEFT JOIN sc USING(motivo) LEFT JOIN cv USING(motivo)
  ORDER BY s.n DESC
`);
console.log("motivo          sesiones  →paso5         →agendó         →convirtió");
for (const r of perMot.rows) {
  const m = r.motivo ?? "?";
  const p5 = r.sessions>0 ? (100*r.registered/r.sessions).toFixed(1) : "0";
  const p6 = r.registered>0 ? (100*r.scheduled/r.registered).toFixed(1) : "0";
  const pc = r.scheduled>0 ? (100*r.converted/r.scheduled).toFixed(1) : "0";
  console.log(`  ${m.padEnd(14)} ${String(r.sessions).padStart(4)}  →  ${String(r.registered).padStart(3)} (${p5.padStart(4)}%)  →  ${String(r.scheduled).padStart(3)} (${p6.padStart(4)}%)  →  ${String(r.converted).padStart(2)} (${pc.padStart(4)}%)`);
}

console.log("\n══════ DÓNDE SE PIERDEN LOS LEADS — pérdida absoluta ══════");
const losses = [
  ["A. Paso 1 → Paso 5 (durante quiz + captura)",    step1 - step5],
  ["B. Paso 5 → Paso 6 (no agendó trial)",           step5 - step6],
  ["C. Paso 6 → Asistencia (no se presentó)",        step6 - attended],
  ["D. Asistencia → Pago (asistió pero no compró)",  attended - converted],
];
losses.sort((a,b)=>b[1]-a[1]);
const maxBar = 50;
const maxLoss = Math.max(...losses.map(l=>l[1]));
for (const [label, n] of losses) {
  const bar = "█".repeat(Math.max(1, Math.round(maxBar * n / Math.max(maxLoss,1))));
  console.log(`  ${label.padEnd(50)} ${String(n).padStart(4)}  ${bar}`);
}

const totalLoss = losses.reduce((a,[,n])=>a+n, 0);
console.log("\n──── Distribución del problema (% del total perdido) ────");
for (const [label, n] of losses) {
  const pct = totalLoss>0 ? (100*n/totalLoss).toFixed(0) : "0";
  console.log(`  ${label.padEnd(50)} ${String(pct).padStart(3)}%`);
}

console.log(`\n🎯 CUELLO DE BOTELLA #1: ${losses[0][0]}  (${losses[0][1]} leads perdidos)`);
if (losses[1]) console.log(`🎯 CUELLO DE BOTELLA #2: ${losses[1][0]}  (${losses[1][1]} leads perdidos)`);

console.log("\n══════ Distribución de respuestas (sólo de los que llegaron a paso 5) ══════");
console.log("(Si una respuesta tiene <5% pero el quiz la ofrece, considera eliminarla.)\n");
const q = (await db.query(`
  SELECT diagnostico_answers->>'level' AS level,
         diagnostico_answers->>'goal' AS goal,
         diagnostico_answers->>'urgency' AS urgency,
         diagnostico_answers->>'budget' AS budget
  FROM leads
  WHERE created_at >= now() - interval '${DAYS} days' AND source='diagnostico'
    AND diagnostico_answers IS NOT NULL
`)).rows;
const tot = q.length;
const bucket = (rows, key) => {
  const m = {};
  for (const r of rows) m[r[key] ?? "(null)"] = (m[r[key] ?? "(null)"] ?? 0) + 1;
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
};
for (const k of ["level","goal","urgency","budget"]) {
  console.log(`  ${k}:`);
  for (const [v,n] of bucket(q, k)) {
    const pct = tot>0 ? (100*n/tot).toFixed(0) : "0";
    console.log(`    ${String(n).padStart(2)} (${pct.padStart(3)}%) · ${v}`);
  }
  console.log("");
}

await db.end();
