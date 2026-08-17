#!/usr/bin/env node
/**
 * E2E test del drip msg 2 (PDF por nivel) + opcionalmente todo el resto.
 *
 * Lo que hace:
 *   1. Busca/crea un lead de prueba con email + WhatsApp dados
 *   2. Lo pone en estado: status='registered', last_drip_msg_n=1,
 *      diagnostico_completed_at = NOW() - 25h
 *      → al siguiente tick del cron, debe disparar msg 2 (PDF)
 *   3. Llama a /api/cron/diagnostico-followups con el CRON_SECRET
 *   4. Reporta el JSON resultado + estado final del lead
 *
 * Uso:
 *   node scripts/test_drip_pdf_e2e.mjs \
 *     --phone +4915253409544 \
 *     --email gelfis07@gmail.com \
 *     --level A0           # opcional: A0 | A1-A2 | B1 | B2+ (default A0)
 *     --base https://b2c.aprender-aleman.de   # opcional
 *
 * Env requeridas (toma del .env del repo):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "web/.env") });
config({ path: resolve(process.cwd(), ".env") });

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const PHONE  = args.phone || "+4915253409544";
const EMAIL  = args.email || "gelfis07@gmail.com";
const LEVEL  = args.level || "A0";  // A0 | A1-A2 | B1 | B2+
const BASE   = (args.base || "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in env");
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error("❌ CRON_SECRET missing in env");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  E2E TEST · diagnostico-followups msg 2 (PDF)");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  Phone: ${PHONE}`);
console.log(`  Email: ${EMAIL}`);
console.log(`  Level: ${LEVEL}`);
console.log(`  Base:  ${BASE}`);
console.log("");

// ─── 1. Busca lead por whatsapp o email ─────────────────────────
const { data: existing, error: lookupErr } = await sb
  .from("leads")
  .select("id, name, email, whatsapp_normalized, status, last_drip_msg_n, german_level, language")
  .or(`whatsapp_normalized.eq.${PHONE},email.eq.${EMAIL}`)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (lookupErr) {
  console.error("❌ lookup failed:", lookupErr.message);
  process.exit(1);
}

const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();

let leadId;
if (existing) {
  console.log(`✓ Lead existente: id=${existing.id} name="${existing.name}" status=${existing.status} drip_n=${existing.last_drip_msg_n}`);
  console.log(`  Updating → status='registered', last_drip_msg_n=1, diagnostico_completed_at=${twentyFiveHoursAgo}`);

  const { error: updErr } = await sb
    .from("leads")
    .update({
      status:                  "registered",
      last_drip_msg_n:         1,                     // siguiente = msg 2 = PDF
      diagnostico_completed_at: twentyFiveHoursAgo,
      german_level:            LEVEL,
      email:                   EMAIL,
      whatsapp_normalized:     PHONE,
      language:                "es",
    })
    .eq("id", existing.id);

  if (updErr) {
    console.error("❌ update failed:", updErr.message);
    process.exit(1);
  }
  leadId = existing.id;
} else {
  console.log(`+ Creando nuevo lead de prueba`);
  const { data: created, error: insErr } = await sb
    .from("leads")
    .insert({
      name:                    "Gelfis (test)",
      whatsapp_normalized:     PHONE,
      whatsapp_raw:            PHONE,
      email:                   EMAIL,
      language:                "es",
      german_level:            LEVEL,
      goal:                    "work",
      urgency:                 "under_3_months",
      status:                  "registered",
      gdpr_accepted:           true,
      gdpr_accepted_at:        new Date().toISOString(),
      source:                  "e2e_test",
      diagnostico_completed_at: twentyFiveHoursAgo,
      last_drip_msg_n:         1,
    })
    .select("id")
    .single();

  if (insErr) {
    console.error("❌ insert failed:", insErr.message);
    process.exit(1);
  }
  leadId = created.id;
  console.log(`✓ Creado lead id=${leadId}`);
}

console.log("");
console.log("─── Disparando cron /api/cron/diagnostico-followups ───");

const cronUrl = `${BASE}/api/cron/diagnostico-followups`;
const res = await fetch(cronUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
});
const body = await res.text();

console.log(`HTTP ${res.status}`);
console.log(body);
console.log("");

// ─── Estado final del lead ──────────────────────────────────────
const { data: after } = await sb
  .from("leads")
  .select("id, status, last_drip_msg_n, last_drip_sent_at")
  .eq("id", leadId)
  .maybeSingle();

console.log("─── Estado final del lead ───");
console.log(after);
console.log("");

// ─── Timeline del lead ──────────────────────────────────────────
const { data: tl } = await sb
  .from("lead_timeline")
  .select("type, content, metadata, created_at")
  .eq("lead_id", leadId)
  .order("created_at", { ascending: false })
  .limit(5);

console.log("─── Timeline reciente ───");
for (const t of tl ?? []) {
  console.log(`  [${t.created_at}] ${t.type}: ${t.content}`);
}
console.log("");

if (after?.last_drip_msg_n === 2) {
  console.log("✅ ÉXITO — el cron ejecutó msg 2 (PDF). Revisa WhatsApp + email ahora.");
} else {
  console.log("⚠️ El cron NO avanzó a msg 2. Revisa logs de Vercel y el JSON arriba.");
}
