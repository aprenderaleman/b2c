// E2E completo: register → book → /confirmacion
// Verifica que toda la cadena del funnel funciona y que /confirmacion
// renderiza el nuevo light-mode design.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const SB = "https://b2c.aprender-aleman.de";
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();
await db.query("DELETE FROM rate_limit_log WHERE scope IN ('diagnostico_register','book_trial')");

let pass=0, fail=0;
const check=(name,ok,extra="")=>{console.log(`  ${ok?"✅":"❌"} ${name}${extra?": "+extra:""}`);ok?pass++:fail++;};

const stamp=Date.now();
const email=`fullflow-${stamp}@test.invalid`;
const wa=`+4915277${String(500000+Math.floor(Math.random()*99999)).slice(-6)}`;

console.log("\n=== STEP 1: Register lead (paso 5 del funnel) ===");
const r1=await fetch(`${SB}/api/public/diagnostico/register`,{
  method:"POST", headers:{"Content-Type":"application/json; charset=utf-8"},
  body: JSON.stringify({
    name:"Full Flow Test", email, whatsapp_e164:wa, language:"es",
    motivo_inicial:"intensivo",
    answers:{ level:"A1 — Conozco lo básico (saludos, números)" },
  }),
});
const j1=await r1.json();
check("register 200", r1.status===200 && j1.ok===true, j1.lead_id);
const leadId=j1.lead_id;

console.log("\n=== STEP 2: Get slots ===");
const slots=await(await fetch(`${SB}/api/public/trial-slots`,{cache:"no-store"})).json();
check("hay slots disponibles", slots.slots?.length>0, `${slots.slots?.length} slots`);

console.log("\n=== STEP 3: Book trial (paso 7 del funnel) ===");
const slot=slots.slots[0];
const r3=await fetch(`${SB}/api/public/book-trial`,{
  method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    name:"Full Flow Test", email, whatsapp_e164:wa, whatsapp_raw:"+49 ...",
    german_level:"A1", goal:"work", language:"es",
    slot_iso:slot.startIso, teacher_id:slot.teacherId, gdpr_accepted:true,
  }),
});
const j3=await r3.json();
check("book-trial 200", r3.status===200 && j3.ok===true);
check("classId presente", !!j3.classId, j3.classId);
check("token presente", !!j3.token);

console.log("\n=== STEP 4: GET /confirmacion?c=...&t=... ===");
if(j3.classId && j3.token) {
  const url=`${SB}/confirmacion?c=${j3.classId}&t=${encodeURIComponent(j3.token)}`;
  const r4=await fetch(url);
  const html=await r4.text();
  check("status 200", r4.status===200, `status=${r4.status}`);
  check("contiene '¡Listo'", /¡Listo/.test(html));
  check("contiene 'Reserva confirmada'", /Reserva confirmada/.test(html));
  check("contiene 'valor de 30'", /valor de 30/.test(html));
  check("contiene 'Ver cursos y precios'", /Ver cursos y precios/.test(html));
  // Light mode markers
  check("light mode: from-rose-50 gradient", /from-rose-50/.test(html));
  check("light mode: bg-white wrapper", /bg-white/.test(html));
  check("light mode: text-slate-900", /text-slate-900/.test(html));
  // NO debe contener clases de dark mode antiguas
  check("NO contiene 'section-navy'", !/section-navy/.test(html));
  check("NO contiene 'bg-navy-900'", !/bg-navy-900/.test(html));
  // SVG illustration de success
  check("contiene SVG success (checkmark)", /viewBox="0 0 280 280"/.test(html));
  // Brand link
  check("brand link visible", /Aprender-Aleman/.test(html));
  // teacher name
  check("teacher name rendered", /Gelfis|profesor/.test(html));
}

console.log("\n=== STEP 5: /confirmacion sin params → redirect / ===");
const r5=await fetch(`${SB}/confirmacion`, {redirect:"manual"});
check("redirige (307/302/308)", [302,307,308].includes(r5.status), `status=${r5.status}`);

console.log("\n=== STEP 6: /confirmacion con token inválido → redirect ===");
const r6=await fetch(`${SB}/confirmacion?c=00000000-0000-0000-0000-000000000000&t=invalid`, {redirect:"manual"});
check("token inválido redirige", [302,307,308].includes(r6.status), `status=${r6.status}`);

console.log("\n=== Limpieza ===");
const cls=await db.query("SELECT id FROM classes WHERE lead_id=$1", [leadId]);
for(const c of cls.rows){
  await db.query("DELETE FROM bookings WHERE class_id=$1",[c.id]).catch(()=>{});
  await db.query("DELETE FROM classes WHERE id=$1",[c.id]);
}
await db.query("DELETE FROM lead_timeline WHERE lead_id=$1",[leadId]);
await db.query("DELETE FROM leads WHERE id=$1",[leadId]);
console.log("  cleanup OK");
await db.end();

console.log(`\n══ RESUMEN ══  ${pass} pasaron, ${fail} fallaron`);
process.exit(fail===0?0:1);
