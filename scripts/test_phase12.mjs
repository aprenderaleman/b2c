// E2E: prueba que el funnel post-fase-1+2 funciona end-to-end:
//   - register acepta answers SIN goal/urgency/budget
//   - book-trial acepta german_level="A1" (no sólo A1.1)
//   - lead acaba con trial_scheduled_at NOT NULL
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const SB = "https://b2c.aprender-aleman.de";
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();
let pass=0, fail=0;
const check = (name, ok, extra="") => { console.log(`  ${ok?"✅":"❌"} ${name}${extra?": "+extra:""}`); ok?pass++:fail++; };

await db.query("DELETE FROM rate_limit_log WHERE scope='diagnostico_register'");
await db.query("DELETE FROM rate_limit_log WHERE scope='book_trial'");

console.log("\n=== TEST 1: Register acepta answers SIN goal/urgency/budget ===");
const stamp = Date.now();
const email = `phase12-${stamp}@test.invalid`;
const wa = `+4915277${String(100000+Math.floor(Math.random()*99999)).slice(-6)}`;
const r1 = await fetch(`${SB}/api/public/diagnostico/register`, {
  method:"POST", headers:{"Content-Type":"application/json; charset=utf-8"},
  body: JSON.stringify({
    name:"Phase12 Test", email, whatsapp_e164: wa, language:"es",
    motivo_inicial:"particulares",
    answers: { level:"A1 — Conozco lo básico (saludos, números)" },  // sin goal/urgency/budget
  }),
});
const j1 = await r1.json();
check("register OK con sólo level", r1.status===200 && j1.ok===true, j1.lead_id);
const leadId = j1.lead_id;

console.log("\n=== TEST 2: Lead persistido con goal/urgency/budget en NULL ===");
const row = await db.query("SELECT german_level, goal, urgency, budget, country FROM leads WHERE id=$1", [leadId]);
check("level=A1", row.rows[0]?.german_level === "A1", `actual=${row.rows[0]?.german_level}`);
check("goal=NULL", row.rows[0]?.goal === null);
check("urgency=NULL", row.rows[0]?.urgency === null);
check("budget=NULL", row.rows[0]?.budget === null);
check("country inferido DE", row.rows[0]?.country === "DE");

console.log("\n=== TEST 3: book-trial acepta german_level='A1' (el bug crítico) ===");
const slots = await (await fetch(`${SB}/api/public/trial-slots`, { cache:"no-store" })).json();
const slot = slots.slots[0];
const r3 = await fetch(`${SB}/api/public/book-trial`, {
  method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    name:"Phase12 Test", email, whatsapp_e164: wa, whatsapp_raw: "+49 15277...",
    german_level: "A1",   // nivel nuevo — antes rechazado
    goal: "work",
    language: "es",
    slot_iso: slot.startIso,
    teacher_id: slot.teacherId,
    gdpr_accepted: true,
  }),
});
const j3 = await r3.json().catch(()=>({}));
check("book-trial 200 OK con A1", r3.status===200 && j3.ok===true, `status=${r3.status}`);
if (!j3.ok) console.log("    error body:", JSON.stringify(j3).slice(0,300));

console.log("\n=== TEST 4: Lead actualizado a trial_scheduled ===");
const row2 = await db.query("SELECT status, trial_scheduled_at FROM leads WHERE id=$1", [leadId]);
check("status pasó a trial_scheduled", row2.rows[0]?.status === "trial_scheduled", `actual=${row2.rows[0]?.status}`);
check("trial_scheduled_at NOT NULL", row2.rows[0]?.trial_scheduled_at !== null);

console.log("\n=== TEST 5: book-trial acepta german_level='C1' (también nuevo) ===");
await db.query("DELETE FROM rate_limit_log WHERE scope='book_trial'");
const email2 = `phase12-c1-${stamp}@test.invalid`;
const wa2 = `+4915277${String(200000+Math.floor(Math.random()*99999)).slice(-6)}`;
await db.query("DELETE FROM rate_limit_log WHERE scope='diagnostico_register'");
const rr = await fetch(`${SB}/api/public/diagnostico/register`, {
  method:"POST", headers:{"Content-Type":"application/json; charset=utf-8"},
  body: JSON.stringify({
    name:"C1 Test", email:email2, whatsapp_e164: wa2, language:"es",
    motivo_inicial:"intensivo",
    answers: { level:"C1 — Nivel avanzado" },
  }),
});
const jj = await rr.json();
const leadId2 = jj.lead_id;
const slot2 = slots.slots[1];
const r5 = await fetch(`${SB}/api/public/book-trial`, {
  method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    name:"C1 Test", email:email2, whatsapp_e164: wa2,
    german_level: "C1", goal: "work", language: "es",
    slot_iso: slot2.startIso, teacher_id: slot2.teacherId, gdpr_accepted: true,
  }),
});
const j5 = await r5.json().catch(()=>({}));
check("book-trial 200 con C1", r5.status===200 && j5.ok===true);

console.log("\n=== TEST 6: book-trial sigue aceptando niveles viejos (compat) ===");
await db.query("DELETE FROM rate_limit_log WHERE scope='book_trial'");
const slot3 = slots.slots[2];
const r6 = await fetch(`${SB}/api/public/book-trial`, {
  method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    name:"Legacy Test", email:`legacy-${stamp}@test.invalid`, whatsapp_e164:`+4915277${String(300000+Math.floor(Math.random()*99999)).slice(-6)}`,
    german_level: "A1.1", goal: "work", language: "es",
    slot_iso: slot3.startIso, teacher_id: slot3.teacherId, gdpr_accepted: true,
  }),
});
const j6 = await r6.json().catch(()=>({}));
check("book-trial acepta A1.1 (legacy)", r6.status===200 && j6.ok===true);

console.log("\n=== TEST 7: HTML del funnel sirve los nuevos textos ===");
const html = await (await fetch(SB+"/")).text();
check("HTML contiene H2 nuevo de particulares", /Tu primera clase con un profesor nativo certificado es gratis/.test(html));
check("HTML contiene prueba social '+800 estudiantes'", /\+800 estudiantes activos/.test(html));
check("HTML NO contiene H2 viejo de particulares", !/vamos a encontrar tu profesor para clases particulares/.test(html));

console.log("\n=== Limpieza ===");
const cls = await db.query("SELECT id FROM classes WHERE notes_admin LIKE '%auto-booked via funnel%' AND created_at > now() - interval '5 minutes'");
for (const c of cls.rows) {
  await db.query("DELETE FROM class_attendees WHERE class_id=$1", [c.id]);
  await db.query("DELETE FROM classes WHERE id=$1", [c.id]);
}
console.log("  classes borradas:", cls.rows.length);
const allLeads = [leadId, leadId2].filter(Boolean);
const dl = await db.query("SELECT id FROM leads WHERE email IN ($1,$2,$3) OR id = ANY($4::uuid[])",
  [`phase12-${stamp}@test.invalid`, `phase12-c1-${stamp}@test.invalid`, `legacy-${stamp}@test.invalid`, allLeads]);
for (const x of dl.rows) {
  await db.query("DELETE FROM lead_timeline WHERE lead_id=$1", [x.id]);
  await db.query("DELETE FROM leads WHERE id=$1", [x.id]);
}
console.log("  leads borrados:", dl.rows.length);
await db.end();

console.log(`\n══ RESUMEN ══  ${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
