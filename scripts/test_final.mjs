// Test final consolidado — todo el sistema verificado end-to-end.
// Verifica: form validation, WhatsApp real (con número de Gelfis),
// /confirmacion, alerts admin, niveles, motivos, edge cases.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const SB = "https://b2c.aprender-aleman.de";
const GELFIS_WA = "+491607530948";

const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${e ? ": " + e : ""}`); c ? pass++ : fail++; };
const reset = async () => db.query("DELETE FROM rate_limit_log WHERE scope IN ('diagnostico_register','book_trial')");

const stamp = Date.now();
const createdIds = [];

// ────────────────────────────────────────────────────────────
console.log("\n══════ 1. HEALTH CHECKS DE ENDPOINTS ══════");
const u1 = await fetch(`${SB}/`);
ok("GET / (funnel home)", u1.status === 200);
const u2 = await fetch(`${SB}/api/public/trial-slots`);
const sj = await u2.json();
ok("GET /api/public/trial-slots", u2.status === 200 && sj.slots?.length > 0, `${sj.slots?.length} slots`);
const u3 = await fetch(`${SB}/api/public/funnel/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: `final-${stamp}-1`, step: 1, answer: "intensivo" }) });
ok("POST /api/public/funnel/track", u3.status === 200);
const u4 = await fetch(`${SB}/api/public/diagnostico/register`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
ok("POST /register valida body vacío (400)", u4.status === 400);
const u5 = await fetch(`${SB}/admin/ads`, { redirect: "manual" });
ok("/admin/ads auth gate", [302, 307, 308].includes(u5.status));
const u6 = await fetch(`${SB}/admin/system`, { redirect: "manual" });
ok("/admin/system auth gate", [302, 307, 308].includes(u6.status));
const u7 = await fetch(`${SB}/confirmacion`, { redirect: "manual" });
ok("/confirmacion sin params redirige", [302, 307, 308].includes(u7.status));

// ────────────────────────────────────────────────────────────
console.log("\n══════ 2. VALIDACIÓN DE FORMULARIO ══════");
await reset();
const v1 = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "X", email: "x@x.com", whatsapp_e164: "+34611223344", language: "es", motivo_inicial: "intensivo", answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
});
ok("Nombre 1 char rechazado", v1.status === 400);

await reset();
const v2 = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Test", email: "", whatsapp_e164: "+34611223344", language: "es", motivo_inicial: "intensivo", answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
});
ok("Email vacío rechazado", v2.status === 400);

await reset();
const v3 = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Test", email: "no-arroba", whatsapp_e164: "+34611223344", language: "es", motivo_inicial: "intensivo", answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
});
ok("Email sin @ rechazado", v3.status === 400);

await reset();
const v4 = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Test", email: `dup-${stamp}@test.invalid`, whatsapp_e164: "+3434611223399", language: "es", motivo_inicial: "intensivo", answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
});
const v4j = await v4.json();
if (v4j.lead_id) {
  createdIds.push(v4j.lead_id);
  const row = await db.query("SELECT whatsapp_normalized FROM leads WHERE id=$1", [v4j.lead_id]);
  ok("Prefijo duplicado +34+34... normalizado", row.rows[0]?.whatsapp_normalized === "+34611223399", row.rows[0]?.whatsapp_normalized);
}

await reset();
const v5 = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Test", email: `otro-${stamp}@test.invalid`, whatsapp_e164: "+34611223300", language: "es", motivo_inicial: "otro", answers: { level: "A0 — Cero, no sé nada" } }),
});
ok("Motivo 'otro' (eliminado) rechazado", v5.status === 400);

// ────────────────────────────────────────────────────────────
console.log("\n══════ 3. 6 NIVELES MCER + 4 MOTIVOS ══════");
const levels = ["A0 — Cero, no sé nada", "A1 — Conozco lo básico (saludos, números)", "A2 — Conversaciones simples del día a día", "B1 — Hablo de temas cotidianos con fluidez", "B2 — Me defiendo en contextos exigentes", "C1 — Nivel avanzado"];
const expected = ["A0", "A1", "A2", "B1", "B2", "C1"];
for (let i = 0; i < levels.length; i++) {
  await reset();
  const r = await fetch(`${SB}/api/public/diagnostico/register`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: "Lvl Test", email: `lvl-${stamp}-${i}@test.invalid`, whatsapp_e164: `+49152770000${i}0`, language: "es", motivo_inicial: "intensivo", answers: { level: levels[i] } }),
  });
  const j = await r.json();
  if (j.lead_id) {
    createdIds.push(j.lead_id);
    const row = await db.query("SELECT german_level FROM leads WHERE id=$1", [j.lead_id]);
    ok(`Nivel ${expected[i]} aceptado y persistido`, row.rows[0]?.german_level === expected[i]);
  } else ok(`Nivel ${expected[i]} aceptado`, false, `status=${r.status}`);
}

for (const m of ["particulares", "intensivo", "certificado", "profesional"]) {
  await reset();
  const r = await fetch(`${SB}/api/public/diagnostico/register`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: "Mot Test", email: `mot-${stamp}-${m}@test.invalid`, whatsapp_e164: `+4915277${String(800000 + Math.floor(Math.random() * 99999)).slice(-6)}`, language: "es", motivo_inicial: m, answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
  });
  const j = await r.json();
  ok(`Motivo ${m}`, r.status === 200 && j.ok === true);
  if (j.lead_id) createdIds.push(j.lead_id);
}

// ────────────────────────────────────────────────────────────
console.log("\n══════ 4. INFERENCIA DE PAÍS POR PREFIJO ══════");
const ccTests = [["+34", "ES"], ["+49", "DE"], ["+1", "US"], ["+57", "CO"], ["+598", "UY"], ["+44", "GB"]];
for (const [cc, expectedCountry] of ccTests) {
  await reset();
  const ph = `${cc}9${String(7000000 + Math.floor(Math.random() * 99999)).slice(-7)}`;
  const r = await fetch(`${SB}/api/public/diagnostico/register`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: "CC Test", email: `cc-${stamp}-${cc.replace("+", "")}@test.invalid`, whatsapp_e164: ph, language: "es", motivo_inicial: "intensivo", answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
  });
  const j = await r.json();
  if (j.lead_id) {
    createdIds.push(j.lead_id);
    const row = await db.query("SELECT country FROM leads WHERE id=$1", [j.lead_id]);
    ok(`Prefijo ${cc} → ${expectedCountry}`, row.rows[0]?.country === expectedCountry, row.rows[0]?.country);
  }
}

// ────────────────────────────────────────────────────────────
console.log("\n══════ 5. FLOW E2E COMPLETO CON WHATSAPP REAL ══════");
await reset();
const finalEmail = `final-${stamp}@test.invalid`;
const finalSid = `final-${stamp}`;
const rReg = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Final E2E Test", email: finalEmail, whatsapp_e164: GELFIS_WA, language: "es", session_id: finalSid, motivo_inicial: "intensivo", answers: { level: "A1 — Conozco lo básico (saludos, números)" } }),
});
const jReg = await rReg.json();
const finalLeadId = jReg.lead_id;
ok("Register OK", rReg.status === 200 && !!finalLeadId, finalLeadId);

const slotsResp = await (await fetch(`${SB}/api/public/trial-slots`, { cache: "no-store" })).json();
const finalSlot = slotsResp.slots[0];
const rBook = await fetch(`${SB}/api/public/book-trial`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Final E2E Test", email: finalEmail, whatsapp_e164: GELFIS_WA, whatsapp_raw: "+49 ...", german_level: "A1", goal: "work", language: "es", slot_iso: finalSlot.startIso, teacher_id: finalSlot.teacherId, gdpr_accepted: true }),
});
const jBook = await rBook.json();
ok("Book-trial OK", rBook.status === 200 && !!jBook.classId);
ok("classId + token recibidos", !!jBook.classId && !!jBook.token);

// Verificar /confirmacion
if (jBook.classId && jBook.token) {
  const confirmResp = await fetch(`${SB}/confirmacion?c=${jBook.classId}&t=${encodeURIComponent(jBook.token)}`);
  const confirmHtml = await confirmResp.text();
  ok("/confirmacion renderiza 200", confirmResp.status === 200);
  ok("/confirmacion contiene '¡Listo, Final'", /¡Listo, Final/.test(confirmHtml));
  ok("/confirmacion contiene 'Reserva confirmada'", /Reserva confirmada/.test(confirmHtml));
  ok("/confirmacion contiene 'valor de 30'", /valor de 30/.test(confirmHtml));
  ok("/confirmacion en light mode", /from-rose-50/.test(confirmHtml) && /bg-white/.test(confirmHtml));
}

console.log("\n  Esperando 20s para que after() complete los sends (WA + email + GCal)...");
let waOk = false, emailOkSent = false, gcalOk = false;
for (let i = 1; i <= 8; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const tl = await db.query("SELECT type, metadata->>'channel' AS ch, content FROM lead_timeline WHERE lead_id=$1", [finalLeadId]);
  waOk = tl.rows.some(r => r.type === "system_message_sent" && r.ch === "whatsapp");
  emailOkSent = tl.rows.some(r => r.type === "system_message_sent" && r.ch === "email");
  gcalOk = tl.rows.some(r => /Google Calendar/.test(r.content));
  process.stdout.write(`  T+${i * 5}s: ${tl.rows.length} eventos\n`);
  if (waOk && emailOkSent) break;
}
ok("WhatsApp confirmación enviado al lead", waOk);
ok("Email confirmación enviado al lead", emailOkSent);
ok("Evento Google Calendar creado", gcalOk);

// Verifica que el status del lead pasó a trial_scheduled
const finalLead = await db.query("SELECT status, trial_scheduled_at FROM leads WHERE id=$1", [finalLeadId]);
ok("Lead status pasó a trial_scheduled", finalLead.rows[0]?.status === "trial_scheduled");
ok("trial_scheduled_at poblado", finalLead.rows[0]?.trial_scheduled_at !== null);

if (finalLeadId) createdIds.push(finalLeadId);

// ────────────────────────────────────────────────────────────
console.log("\n══════ 6. ALERTA A ADMIN AL CREAR LEAD ══════");
console.log("  (notifyNewLeadUrgent: WhatsApp + email + in-app a superadmins)");
await reset();
const adminAlertEmail = `alert-${stamp}@test.invalid`;
const adminAlertWa = `+49160${String(8000000 + Math.floor(Math.random() * 99999)).slice(-7)}`;
const ralert = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Alert Test Lead", email: adminAlertEmail, whatsapp_e164: adminAlertWa, language: "es", motivo_inicial: "intensivo", answers: { level: "B1 — Hablo de temas cotidianos con fluidez" } }),
});
const jalert = await ralert.json();
if (jalert.lead_id) createdIds.push(jalert.lead_id);
ok("Lead 'Alert Test Lead' creado (admin debería recibir WA + email + bell)", ralert.status === 200);
console.log("  📱 Verifica en tu WhatsApp +491607530948: debería llegar '🚨 IMPORTANTE: Nuevo Lead · Alert Test Lead'");

// ────────────────────────────────────────────────────────────
console.log("\n══════ 7. RATE LIMIT FUNCIONA ══════");
// Después de los muchos requests anteriores, otro request DEBERÍA estar rate-limited
const rateLimitR = await fetch(`${SB}/api/public/diagnostico/register`, {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ name: "Rate Test", email: `rate-${stamp}@test.invalid`, whatsapp_e164: "+4915277900001", language: "es", motivo_inicial: "intensivo", answers: { level: "A0 — Cero, no sé nada" } }),
});
ok("Rate limit responde 429 tras spam", rateLimitR.status === 429);

// ────────────────────────────────────────────────────────────
console.log("\n══════ 8. /admin/ads DATA REAL ══════");
const sessionsCount = (await db.query("SELECT count(*) FROM lead_motivo_inicial WHERE created_at >= now() - interval '24 hours'")).rows[0].count;
const leadsCount = (await db.query("SELECT count(*) FROM leads WHERE source='diagnostico' AND created_at >= now() - interval '24 hours'")).rows[0].count;
const trialsCount = (await db.query("SELECT count(*) FROM leads WHERE source='diagnostico' AND created_at >= now() - interval '24 hours' AND trial_scheduled_at IS NOT NULL")).rows[0].count;
console.log(`  Sesiones (paso 1) 24h: ${sessionsCount}`);
console.log(`  Leads completados 24h: ${leadsCount}`);
console.log(`  Trials agendadas 24h:  ${trialsCount}`);
ok("Hay tráfico para mostrar en /admin/ads", +sessionsCount > 0);

// ────────────────────────────────────────────────────────────
console.log("\n══════ LIMPIEZA ══════");
for (const id of createdIds) {
  const cls = await db.query("SELECT id FROM classes WHERE lead_id=$1", [id]);
  for (const c of cls.rows) {
    await db.query("DELETE FROM bookings WHERE class_id=$1", [c.id]).catch(() => {});
    await db.query("DELETE FROM classes WHERE id=$1", [c.id]);
  }
  await db.query("DELETE FROM lead_timeline WHERE lead_id=$1", [id]);
  await db.query("DELETE FROM leads WHERE id=$1", [id]);
}
console.log(`  Leads de test borrados: ${createdIds.length}`);

await db.end();

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  RESULTADO FINAL:   ${pass} pasaron   ·   ${fail} fallaron`);
console.log("══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
