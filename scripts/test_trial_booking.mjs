// Reproduce paso a paso lo que hace el funnel: register → book-trial.
// Si falla en book-trial sabremos el motivo exacto del 0/15.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = "https://b2c.aprender-aleman.de";
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();
await db.query("DELETE FROM rate_limit_log WHERE scope='diagnostico_register'");

const stamp = Date.now();
const email = `trial-test-${stamp}@test.invalid`;
const whatsapp = `+4915277${String(900000+Math.floor(Math.random()*99999)).slice(-6)}`;

console.log("\n[1] POST /api/public/diagnostico/register");
const r1 = await fetch(`${sb}/api/public/diagnostico/register`, {
  method:"POST", headers:{"Content-Type":"application/json; charset=utf-8"},
  body: JSON.stringify({
    name:"Trial Test", email, whatsapp_e164: whatsapp, language:"es",
    motivo_inicial:"intensivo",
    answers:{ level:"A1 — Conozco lo básico (saludos, números)", goal:"Trabajo", urgency:"6 meses", budget:"100-300€/mes" },
  }),
});
const j1 = await r1.json();
console.log("  status:", r1.status, "body:", JSON.stringify(j1).slice(0,200));
if (!j1.ok) { console.error("REGISTER FAILED"); await db.end(); process.exit(1); }
const leadId = j1.lead_id;

console.log("\n[2] GET /api/public/trial-slots");
const r2 = await fetch(`${sb}/api/public/trial-slots`, { cache: "no-store" });
const j2 = await r2.json();
const slot = j2.slots[0];
console.log("  slots:", j2.slots.length, "first:", slot.startIso, "teacher:", slot.teacherName);

console.log("\n[3] POST /api/public/book-trial (cliente igual al funnel)");
const r3 = await fetch(`${sb}/api/public/book-trial`, {
  method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    name:"Trial Test",
    email,
    whatsapp_e164: whatsapp,
    whatsapp_raw: `+49 15277...`,
    german_level: "A1",
    goal: "work",
    language: "es",
    slot_iso: slot.startIso,
    teacher_id: slot.teacherId,
    gdpr_accepted: true,
  }),
});
const j3 = await r3.json().catch(()=>({}));
console.log("  status:", r3.status, "body:", JSON.stringify(j3));

console.log("\n[4] Verificación en BD");
const row = await db.query("SELECT id, status, trial_scheduled_at FROM leads WHERE id=$1", [leadId]);
console.log("  ", row.rows[0]);

// Limpieza
console.log("\n[5] Limpieza");
await db.query("DELETE FROM classes WHERE id IN (SELECT id FROM classes WHERE notes LIKE '%trial-test-%' OR id IN (SELECT class_id FROM class_attendees WHERE user_id IN (SELECT converted_to_user_id FROM leads WHERE email=$1)))", [email]).catch(()=>{});
await db.query("DELETE FROM lead_timeline WHERE lead_id=$1", [leadId]);
await db.query("DELETE FROM leads WHERE id=$1", [leadId]);
console.log("  ok");

await db.end();
