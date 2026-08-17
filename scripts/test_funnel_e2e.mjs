// Test E2E de cada nivel + cada motivo contra el endpoint live.
// Crea leads sintéticos, verifica respuestas, y los borra al final.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const env = Object.fromEntries(
  fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#"))
    .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}),
);

const URL = "https://b2c.aprender-aleman.de/api/public/diagnostico/register";

const LEVELS = [
  "A0 — Cero, no sé nada",
  "A1 — Conozco lo básico (saludos, números)",
  "A2 — Conversaciones simples del día a día",
  "B1 — Hablo de temas cotidianos con fluidez",
  "B2 — Me defiendo en contextos exigentes",
  "C1 — Nivel avanzado",
];

const MOTIVOS = ["particulares", "intensivo", "certificado", "profesional"];

const createdIds = [];
const stamp = Date.now();
let casen = 0;

console.log("=== TEST 1: Los 6 niveles MCER ===");
for (const lvl of LEVELS) {
  casen++;
  const email = `synthtest-lvl-${stamp}-${casen}@aprender-aleman.de`;
  const body = {
    name: `Synth Lvl ${casen}`,
    email,
    whatsapp_e164: `+34699${String(100000 + casen).slice(-6)}`,
    country: "ES",
    language: "es",
    gdpr_accepted: true,
    motivo_inicial: "intensivo",
    answers: {
      level: lvl,
      goal: "Trabajo",
      urgency: "6 meses",
      budget: "Estoy evaluando",
    },
  };
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const ok = res.status === 200 && json.ok === true;
  console.log(`  ${ok ? "✅" : "❌"} ${lvl.padEnd(50)} → ${res.status} ${ok ? json.lead_id : JSON.stringify(json).slice(0,150)}`);
  if (ok) createdIds.push(json.lead_id);
}

console.log("\n=== TEST 2: Los 4 motivos ===");
for (const m of MOTIVOS) {
  casen++;
  const email = `synthtest-mot-${stamp}-${casen}@aprender-aleman.de`;
  const body = {
    name: `Synth Mot ${casen}`,
    email,
    whatsapp_e164: `+34699${String(200000 + casen).slice(-6)}`,
    country: "ES",
    language: "es",
    gdpr_accepted: true,
    motivo_inicial: m,
    answers: {
      level: "A1 — Conozco lo básico (saludos, números)",
      goal: "Trabajo",
      urgency: "Lo antes posible (3 meses)",
      budget: "100-300€/mes",
    },
  };
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const ok = res.status === 200 && json.ok === true;
  console.log(`  ${ok ? "✅" : "❌"} motivo=${m.padEnd(13)} → ${res.status} ${ok ? json.lead_id : JSON.stringify(json).slice(0,150)}`);
  if (ok) createdIds.push(json.lead_id);
}

console.log("\n=== TEST 3: Rechazo motivo 'otro' (debe fallar 400) ===");
const resOtro = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    name: "Synth Otro", email: `synthtest-otro-${stamp}@aprender-aleman.de`,
    whatsapp_e164: "+34699300000", country: "ES", gdpr_accepted: true,
    motivo_inicial: "otro",
    answers: { level: "A0 — Cero, no sé nada", goal: "Trabajo", urgency: "6 meses", budget: "Estoy evaluando" },
  }),
});
const jOtro = await resOtro.json();
const otroRejected = resOtro.status === 400 && jOtro.error === "validation_failed";
console.log(`  ${otroRejected ? "✅" : "❌"} motivo='otro' rechazado: status=${resOtro.status} error=${jOtro.error}`);

console.log("\n=== TEST 4: Rechazo nivel viejo (debe fallar 400) ===");
const resOldLvl = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    name: "Synth Old Lvl", email: `synthtest-oldlvl-${stamp}@aprender-aleman.de`,
    whatsapp_e164: "+34699400000", country: "ES", gdpr_accepted: true,
    motivo_inicial: "intensivo",
    answers: { level: "Conozco lo básico (saludos, números) — A1.1", goal: "Trabajo", urgency: "6 meses", budget: "Estoy evaluando" },
  }),
});
const jOld = await resOldLvl.json();
const oldRejected = resOldLvl.status === 400 && jOld.error === "validation_failed";
console.log(`  ${oldRejected ? "✅" : "❌"} nivel viejo (A1.1) rechazado: status=${resOldLvl.status}`);

console.log("\n=== TEST 5: Endpoint /api/public/motivo con 'otro' rechazado ===");
const resMot = await fetch("https://b2c.aprender-aleman.de/api/public/motivo", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ session_id: `synthtest-${stamp}`, motivo: "otro" }),
});
const jMot = await resMot.json().catch(()=>({}));
console.log(`  ${resMot.status === 400 ? "✅" : "❌"} POST /api/public/motivo {motivo:otro} → status=${resMot.status}`);

console.log("\n=== TEST 6: Verificación en BD ===");
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();
const r = await db.query(
  `SELECT id, name, german_level, motivo_inicial FROM leads WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
  [createdIds],
);
console.log(`  ${r.rows.length}/${createdIds.length} leads recuperados de BD:`);
for (const row of r.rows) {
  console.log(`    ${row.name.padEnd(20)} · level=${(row.german_level??"NULL").padEnd(6)} · motivo=${row.motivo_inicial}`);
}

// Cleanup
console.log("\n=== Limpieza ===");
const del1 = await db.query(`DELETE FROM lead_timeline WHERE lead_id = ANY($1::uuid[])`, [createdIds]);
const del2 = await db.query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [createdIds]);
console.log(`  Borrados ${del2.rowCount} leads + ${del1.rowCount} timeline rows.`);
await db.end();

console.log("\n=== RESUMEN ===");
const total = LEVELS.length + MOTIVOS.length + 3;
const passed = createdIds.length + (otroRejected ? 1 : 0) + (oldRejected ? 1 : 0) + (resMot.status === 400 ? 1 : 0);
console.log(`Tests pasados: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
