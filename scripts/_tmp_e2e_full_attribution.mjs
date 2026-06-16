/**
 * E2E completo de atribución — simula EL FLUJO PRINCIPAL:
 *   Google Ads click → landing dedicada → CTA verde → /agendar/cuando → book-trial
 *
 * El test envía a book-trial todos los campos que el flujo real
 * mandaría tras los fixes (landing_intent del slug + gclid/utm).
 * Luego verifica que la fila en `leads` tiene TODO persistido y
 * que el endpoint devuelve leadId para que los pixels disparen.
 */
import { config } from "dotenv";
import { resolve } from "path";
import pg from "pg";
config({ path: resolve(process.cwd(), ".env") });

const PLATFORM_URL = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
const TS = Date.now();
const TEST_EMAIL = `e2e-attrib+${TS}@aprender-aleman-test.de`;
const TEST_NAME  = `E2E Attrib ${TS}`;
const TEST_WA    = "+4915253409544";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log("\n[1/4] Buscando slot…");
const slotsRes = await fetch(`${PLATFORM_URL}/api/public/trial-slots`, { cache: "no-store" });
const slots = (await slotsRes.json()).slots ?? [];
if (slots.length === 0) { console.error("Sin slots"); await client.end(); process.exit(1); }
const slot = slots[Math.min(2, slots.length - 1)];
console.log(`   ${slot.startIso} / teacher ${slot.teacherId}`);

console.log("\n[2/4] POST book-trial con atribución completa (simula click Google Ads → landing 'particulares' → /agendar/cuando)…");
const body = {
  name:           TEST_NAME,
  email:          TEST_EMAIL,
  whatsapp_e164:  TEST_WA,
  whatsapp_raw:   `+49 152 5340 9544`,
  german_level:   "A1",
  goal:           "work",
  language:       "es",
  slot_iso:       slot.startIso,
  teacher_id:     slot.teacherId,
  landing_intent: "particulares",
  motivo_inicial: "particulares",
  gclid:          `test_gclid_${TS}`,
  utm_source:     "google",
  utm_medium:     "cpc",
  utm_campaign:   "spain_particulares_2026Q2",
};
const res = await fetch(`${PLATFORM_URL}/api/public/book-trial`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(`   ← status=${res.status} ok=${json.ok}`);
console.log(`   ← classId=${json.classId}`);
console.log(`   ← leadId=${json.leadId ?? "(MISSING!)"}`);

if (!res.ok || !json.ok) { console.error("FAIL:", json); await client.end(); process.exit(1); }

console.log("\n[3/4] Verificando persistencia en `leads`…");
const { rows } = await client.query(`
  SELECT id, name, email, whatsapp_normalized, status, source,
         motivo_inicial, landing_intent,
         gclid, gbraid, wbraid,
         utm_source, utm_medium, utm_campaign, utm_term, utm_content,
         german_level, trial_scheduled_at, updated_at
  FROM leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1
`, [TEST_EMAIL.toLowerCase()]);
if (rows.length === 0) { console.error("Lead no encontrado"); await client.end(); process.exit(1); }
const l = rows[0];

const checks = [
  ["leadId devuelto por endpoint",       json.leadId === l.id],
  ["landing_intent='particulares'",      l.landing_intent === "particulares"],
  ["motivo_inicial='particulares'",      l.motivo_inicial === "particulares"],
  [`gclid='${body.gclid}' persistido`,   l.gclid === body.gclid],
  ["utm_source='google' persistido",     l.utm_source === "google"],
  ["utm_medium='cpc' persistido",        l.utm_medium === "cpc"],
  ["utm_campaign persistido",            l.utm_campaign === body.utm_campaign],
  ["german_level=A1",                    l.german_level === "A1"],
  ["whatsapp_normalized=+49...",         l.whatsapp_normalized === TEST_WA],
  ["status=trial_scheduled",             l.status === "trial_scheduled"],
  ["source=funnel_trial_self_book",      l.source === "funnel_trial_self_book"],
  ["trial_scheduled_at coincide",        l.trial_scheduled_at?.toISOString?.() === slot.startIso],
  ["updated_at presente",                !!l.updated_at],
];

console.log(`   Lead row:`);
console.log(`     name=${l.name}`);
console.log(`     landing=${l.landing_intent}  motivo=${l.motivo_inicial}`);
console.log(`     gclid=${l.gclid}  utm_source=${l.utm_source}  utm_campaign=${l.utm_campaign}`);
console.log(`\n   Validaciones:`);
let pass = 0, fail = 0;
for (const [name, ok] of checks) {
  console.log(`   ${ok ? "✅" : "❌"} ${name}`);
  ok ? pass++ : fail++;
}

console.log("\n[4/4] Verificando que aparece en getLeads() top-3 por updated_at DESC…");
const { rows: top } = await client.query(`
  SELECT id, name, email, landing_intent, updated_at
  FROM leads ORDER BY updated_at DESC NULLS LAST LIMIT 3
`);
top.forEach((r, i) => {
  const flag = r.id === l.id ? "  ← NUESTRO" : "";
  console.log(`   #${i+1}  ${r.updated_at?.toISOString?.()}  ${r.email}  landing=${r.landing_intent}${flag}`);
});
const position = top.findIndex(r => r.id === l.id) + 1;
console.log(`   ${position === 1 ? "✅" : "⚠️"} Posición en /admin/funnel: #${position || "no aparece"}`);

console.log(`\n${"=".repeat(60)}`);
console.log(`RESULTADO: ${pass} ✅  ${fail} ❌`);
console.log(`Lead: ${l.id}  Class: ${json.classId}`);
console.log(`${"=".repeat(60)}`);

await client.end();
process.exit(fail > 0 ? 1 : 0);
