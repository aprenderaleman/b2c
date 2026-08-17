// Test E2E del funnel v2: telemetría granular + register sin país/GDPR.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));

const sb = "https://b2c.aprender-aleman.de";
const stamp = Date.now();
const sid = `e2e-${stamp}`;
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

// Limpia rate-limit
await db.query("DELETE FROM rate_limit_log WHERE scope='diagnostico_register'");

let pass = 0, fail = 0;
const check = (name, ok, extra="") => { console.log(`  ${ok?"✅":"❌"} ${name}${extra?": "+extra:""}`); ok?pass++:fail++; };

console.log("=== TEST 1: Telemetría /api/public/funnel/track ===");
for (const [step, ans] of [[1,"intensivo"],[2,"A1 — Conozco lo básico (saludos, números)"],[3,"Trabajo"],[4,"6 meses"],[5,"100-300€/mes"]]) {
  const r = await fetch(`${sb}/api/public/funnel/track`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ session_id: sid, step, answer: ans })
  });
  check(`POST track step=${step} answer="${ans.slice(0,30)}..."`, r.status===200);
}

console.log("\n=== TEST 2: Idempotencia (mismo step 2 veces) ===");
const r1 = await fetch(`${sb}/api/public/funnel/track`, {
  method: "POST", headers: {"Content-Type":"application/json"},
  body: JSON.stringify({ session_id: sid, step: 1, answer: "intensivo" })
});
check("Reintento step=1 devuelve 200 (no rompe)", r1.status===200);

console.log("\n=== TEST 3: Validación rechaza step inválido ===");
const r2 = await fetch(`${sb}/api/public/funnel/track`, {
  method: "POST", headers: {"Content-Type":"application/json"},
  body: JSON.stringify({ session_id: sid, step: 99, answer: "x" })
});
check("step=99 rechazado", r2.status===400);

console.log("\n=== TEST 4: Register SIN country y SIN gdpr_accepted (cliente nuevo) ===");
const email = `e2e-nogdpr-${stamp}@test.invalid`;
const r3 = await fetch(`${sb}/api/public/diagnostico/register`, {
  method: "POST", headers: {"Content-Type":"application/json; charset=utf-8"},
  body: JSON.stringify({
    name: `E2E NoGdpr ${stamp}`, email, whatsapp_e164: "+4915277000001",
    language: "es", session_id: sid, motivo_inicial: "intensivo",
    answers: { level: "A1 — Conozco lo básico (saludos, números)", goal: "Trabajo", urgency: "6 meses", budget: "100-300€/mes" },
  }),
});
const j3 = await r3.json();
check("Register sin country/gdpr devuelve 200", r3.status===200 && j3.ok===true, j3.lead_id);
const leadId = j3.lead_id;

console.log("\n=== TEST 5: País inferido del prefijo +49 → DE ===");
if (leadId) {
  const row = await db.query("SELECT country, gdpr_accepted FROM leads WHERE id=$1", [leadId]);
  check("country inferido a DE", row.rows[0]?.country === "DE", `actual=${row.rows[0]?.country}`);
  check("gdpr_accepted server-side a TRUE", row.rows[0]?.gdpr_accepted === true);
}

console.log("\n=== TEST 6: Prefijos varios ===");
for (const [cc, expected] of [["+34","ES"],["+1","US"],["+57","CO"],["+44","GB"],["+598","UY"]]) {
  await db.query("DELETE FROM rate_limit_log WHERE scope='diagnostico_register'");
  const ph = `${cc}9${String(7000000+Math.floor(Math.random()*100000)).slice(-7)}`;
  const em = `e2e-cc${cc.replace("+","")}-${stamp}-${Math.random().toString(36).slice(2,6)}@test.invalid`;
  const r = await fetch(`${sb}/api/public/diagnostico/register`, {
    method: "POST", headers: {"Content-Type":"application/json; charset=utf-8"},
    body: JSON.stringify({
      name: `Test ${cc}`, email: em, whatsapp_e164: ph, language: "es",
      motivo_inicial: "intensivo",
      answers: { level: "A1 — Conozco lo básico (saludos, números)", goal: "Trabajo", urgency: "6 meses", budget: "Estoy evaluando" },
    }),
  });
  const j = await r.json();
  if (r.status === 200 && j.lead_id) {
    const row = await db.query("SELECT country FROM leads WHERE id=$1", [j.lead_id]);
    check(`Prefijo ${cc} → ${expected}`, row.rows[0]?.country === expected, `actual=${row.rows[0]?.country}`);
  } else {
    check(`Prefijo ${cc} → ${expected}`, false, `status=${r.status}`);
  }
}

console.log("\n=== TEST 7: BD funnel_progress ===");
const fp = await db.query("SELECT step, answer FROM funnel_progress WHERE session_id=$1 ORDER BY step", [sid]);
check(`Filas de telemetría para sid=${sid}`, fp.rows.length === 5, `${fp.rows.length} rows`);
for (const r of fp.rows) console.log(`    step=${r.step} answer="${(r.answer??"").slice(0,40)}"`);

console.log("\n=== TEST 8: /admin/ads carga (HTTP) ===");
const adsHtml = await fetch(`${sb}/admin/ads`, { redirect: "manual" });
check("/admin/ads existe (redirect a login o 200)", [200,302,307].includes(adsHtml.status), `status=${adsHtml.status}`);

console.log("\n=== Limpieza ===");
const cleanup = await db.query(`
  DELETE FROM leads WHERE email LIKE 'e2e-%test.invalid' OR email LIKE 'e2e-nogdpr-%test.invalid'
  RETURNING id
`);
console.log(`  Borrados ${cleanup.rowCount} leads de test.`);
await db.query("DELETE FROM funnel_progress WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'deploy-probe-%'");

await db.end();

console.log(`\n══ RESUMEN ══  ${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
