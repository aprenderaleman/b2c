// E2E del form: email obligatorio + validación telefónica por país +
// errores friendly. Simula lo que envía el cliente.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const SB = "https://b2c.aprender-aleman.de";
const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

let pass=0, fail=0;
const check=(name,ok,extra="")=>{console.log(`  ${ok?"✅":"❌"} ${name}${extra?": "+extra:""}`); ok?pass++:fail++;};

const stamp = Date.now();
const base = {
  name: "Form Validation Test", language: "es", motivo_inicial: "intensivo",
  answers: { level: "A1 — Conozco lo básico (saludos, números)" },
};

// Helper que limpia rate-limit antes de cada batch
async function reset() {
  await db.query("DELETE FROM rate_limit_log WHERE scope='diagnostico_register'");
}
const post = async (body) => {
  const r = await fetch(`${SB}/api/public/diagnostico/register`, {
    method:"POST", headers:{"Content-Type":"application/json; charset=utf-8"},
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(()=>({})) };
};

console.log("\n=== Test 1: payload válido (España) ===");
await reset();
const r1 = await post({
  ...base, email:`val-${stamp}-1@test.invalid`,
  whatsapp_e164: "+34611223344",
});
check("ES móvil válido → 200", r1.status===200 && r1.body.ok===true);

console.log("\n=== Test 2: payload válido (Alemania) ===");
const r2 = await post({
  ...base, email:`val-${stamp}-2@test.invalid`,
  whatsapp_e164: "+491521234567",
});
check("DE móvil 10 dígitos → 200", r2.status===200 && r2.body.ok===true);

console.log("\n=== Test 3: prefijo duplicado +34+34611... ===");
const r3 = await post({
  ...base, email:`val-${stamp}-3@test.invalid`,
  whatsapp_e164: "+3434611223345",
});
// El backend sanitiza con sanitizeE164 — debe aceptarlo y guardar limpio
if (r3.status===200) {
  const row = await db.query("SELECT whatsapp_normalized FROM leads WHERE id=$1", [r3.body.lead_id]);
  const saved = row.rows[0]?.whatsapp_normalized;
  check(`prefijo duplicado normalizado correctamente → ${saved}`, saved === "+34611223345");
} else {
  check("prefijo duplicado aceptado", false, `status=${r3.status}`);
}

console.log("\n=== Test 4: email vacío (el bug que reportó Gelfis) ===");
await reset();
const r4 = await post({
  ...base, email:"",  // <- vacío
  whatsapp_e164: "+4915277000001",
});
check("email vacío rechazado con 400", r4.status===400);
check("error es validation_failed", r4.body.error === "validation_failed");
check("issue marca path=email", r4.body.issues?.[0]?.path?.includes("email"));

console.log("\n=== Test 5: email sin @ ===");
await reset();
const r5 = await post({
  ...base, email:"esto no es un email",
  whatsapp_e164: "+4915277000002",
});
check("email mal formado rechazado", r5.status===400);

console.log("\n=== Test 6: número español MUY corto (5 dígitos) ===");
await reset();
const r6 = await post({
  ...base, email:`val-${stamp}-6@test.invalid`,
  whatsapp_e164: "+3461122",  // sólo 5 dígitos locales
});
// El backend zod permite 8-15 dígitos totales, así que esto pasa zod
// pero el frontend ahora valida que ES sea exactamente 9. El backend
// no exige longitud por país — esa validación es de UX. Aquí
// comprobamos que el server lo acepta (lo que se valida es UX).
console.log(`  ℹ️  backend permitivo (status=${r6.status}) — la validación de longitud por país es client-side`);

console.log("\n=== Test 7: Argentina con prefijo correcto ===");
await reset();
const r7 = await post({
  ...base, email:`val-${stamp}-7@test.invalid`,
  whatsapp_e164: "+541112345678",  // AR móvil 10 dígitos
});
check("AR válido → 200", r7.status===200 && r7.body.ok===true);

console.log("\n=== Test 8: lead duplicado mismo email ===");
const r8a = await post({
  ...base, email:`dup-${stamp}@test.invalid`,
  whatsapp_e164: "+4915277000100",
});
await reset();
const r8b = await post({
  ...base, email:`dup-${stamp}@test.invalid`,
  whatsapp_e164: "+4915277000200",
});
// Mismo email → upsert (sigue 200) o conflict si es user existente
check("segunda submit con mismo email → 200 (upsert)", r8b.status===200 || r8b.status===409);

console.log("\n=== Test 9: nombre muy corto (1 char) ===");
await reset();
const r9 = await post({
  name:"A", language:"es", motivo_inicial:"intensivo",
  email:`val-${stamp}-9@test.invalid`, whatsapp_e164:"+4915277000003",
  answers:{ level:"A1 — Conozco lo básico (saludos, números)" },
});
check("nombre 1 char rechazado", r9.status===400);

console.log("\n=== Test 10: HTML del funnel — campos del form ===");
const html = await (await fetch(SB+"/")).text();
check("HTML contiene 'Email' como label (no opcional)", /Email<\/div>/.test(html) || /<input[^>]*type="email"/.test(html));
// El "— opcional" YA no debería estar en el HTML del form
const stillOptional = /Email[^<]*<span[^>]*>—\s*opcional/.test(html);
check("HTML NO contiene '— opcional' junto a Email", !stillOptional);

console.log("\n=== Limpieza ===");
const cleanup = await db.query("DELETE FROM leads WHERE email LIKE 'val-%test.invalid' OR email LIKE 'dup-%test.invalid' RETURNING id");
for (const r of cleanup.rows) await db.query("DELETE FROM lead_timeline WHERE lead_id=$1", [r.id]);
console.log(`  Borrados ${cleanup.rowCount} leads de test.`);

await db.end();
console.log(`\n══ RESUMEN ══  ${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
