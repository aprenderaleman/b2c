#!/usr/bin/env node
/**
 * Send a WhatsApp message directly through the public Evolution API
 * that runs on the VPS (evolution.aprender-aleman.de), bypassing the
 * dead scheduler on the agents side. Also logs it to lead_timeline +
 * advances the lead status so the agents don't duplicate the message
 * once they're resurrected.
 *
 * Usage:
 *   node scripts/send_manual_message.mjs <lead_id>
 *   node scripts/send_manual_message.mjs --name Isabella
 *
 * Reads EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE_MAIN
 * from .env.prod (not .env — the dev one points to localhost).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const devEnv  = loadEnv(path.join(repoRoot, ".env"));
const prodEnv = loadEnv(path.join(repoRoot, ".env.prod"));
// Override dev with prod for Evolution so we hit the real server.
const env = { ...devEnv, ...prodEnv };

// Public URL (Traefik-exposed).
const evolutionUrl  = "https://evolution.aprender-aleman.de";
const evolutionKey  = prodEnv.EVOLUTION_API_KEY;
const instance      = prodEnv.EVOLUTION_INSTANCE_MAIN ?? "aprender-aleman-main";

if (!evolutionKey) { console.error("EVOLUTION_API_KEY missing in .env.prod"); process.exit(1); }

// ── Parse CLI args ──────────────────────────────────────────
const args = process.argv.slice(2);
let leadId = null, nameMatch = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--name") nameMatch = args[++i];
  else if (!leadId && args[i].match(/^[0-9a-f-]{32,}$/i)) leadId = args[i];
}
if (!leadId && !nameMatch) {
  console.error("Usage: node send_manual_message.mjs <lead_id> | --name Isabella");
  process.exit(1);
}

// ── Connect DB ──────────────────────────────────────────────
const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const lookup = leadId
  ? await db.query(`SELECT id, name, whatsapp_normalized, language, goal, status, current_followup_number FROM leads WHERE id = $1`, [leadId])
  : await db.query(`SELECT id, name, whatsapp_normalized, language, goal, status, current_followup_number FROM leads WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 1`, [`%${nameMatch}%`]);

if (lookup.rows.length === 0) {
  console.error("Lead not found.");
  process.exit(2);
}
const lead = lookup.rows[0];
console.log("Lead:", lead);

// ── Build contact_1 template (port of agents/agent_1_writer.py) ──
const GOAL_ES = {
  work:             "tu meta de trabajar en Alemania",
  visa:             "que obtengas tu visa",
  studies:          "que entres a la universidad alemana",
  exam:             "que apruebes tu examen oficial",
  travel:           "que te puedas comunicar sin problemas",
  already_in_dach:  "que domines el alemán en tu día a día",
};
const GOAL_DE = {
  work:             "deinen Job in Deutschland oder der Schweiz",
  visa:             "deinen Visumsantrag",
  studies:          "dein Uni-Ziel",
  exam:             "deine offizielle Prüfung",
  travel:           "sicheres Kommunizieren auf Deutsch",
  already_in_dach:  "deinen Alltag in DACH",
};

const firstName = (lead.name || "").trim().split(/\s+/)[0] || "";
const ctx = (lead.language === "de" ? GOAL_DE : GOAL_ES)[lead.goal] ?? GOAL_ES.work;

const textEs =
`¡Hola ${firstName}! 👋

Soy Stiv de Aprender-Aleman.de — recibimos tu solicitud.

Nos gustaría invitarte a una *clase de prueba gratuita* para conocer tu nivel y diseñarte un plan personalizado para ${ctx}.

¿Te envío el enlace para que elijas el horario que mejor te venga?

Stiv, Aprender-Aleman.de`;

const textDe =
`Hallo ${firstName}! 👋

Ich bin Stiv von Aprender-Aleman.de — wir haben deine Anfrage erhalten.

Wir würden dich gerne zu einer *kostenlosen Probestunde* einladen, um dein Niveau zu prüfen und einen persönlichen Plan für ${ctx} zu erstellen.

Soll ich dir den Link zum Terminbuchen schicken?

Stiv, Aprender-Aleman.de`;

const text = lead.language === "de" ? textDe : textEs;
console.log("\n── Message to send ──\n" + text + "\n──");

// ── Chequeos de seguridad (audit 2026-07-24) ────────────────
// Este script bypasseaba el kill switch + blocklist. Ahora consulta
// system_config.whatsapp_disabled y aborta si está "full" o "partial".
// Y bloquea números en HARDCODED_BLOCKLIST (Gelfis personal).
const toNumber = lead.whatsapp_normalized.replace(/\D/g, "");

const HARDCODED_BLOCKLIST = new Set(["491607530948"]);
if (HARDCODED_BLOCKLIST.has(toNumber)) {
  console.error(`ABORT: ${toNumber} está en HARDCODED_BLOCKLIST (Gelfis personal).`);
  await db.end();
  process.exit(4);
}

const cfg = await db.query(
  `SELECT key, value FROM system_config
     WHERE key IN ('whatsapp_disabled','wa_night_gate_enabled','wa_daily_send_cap')`,
);
const cfgMap = new Map(cfg.rows.map(r => [r.key, r.value]));
const killMode = cfgMap.get("whatsapp_disabled") ?? "off";
if (killMode === "full" || killMode === "partial") {
  console.error(`ABORT: kill switch WhatsApp en modo "${killMode}". Este script bypasea la whitelist — abortando.`);
  console.error(`Para desbloquear temporalmente: UPDATE system_config SET value='off' WHERE key='whatsapp_disabled';`);
  await db.end();
  process.exit(5);
}

// Gate nocturno (22-08 Berlin) — este script manda contact_1, no es transaccional.
const berlinHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin", hour: "numeric", hour12: false,
}).format(new Date());
const h = parseInt(berlinHour, 10);
if ((cfgMap.get("wa_night_gate_enabled") ?? "true") !== "false" && (h >= 22 || h < 8)) {
  console.error(`ABORT: gate nocturno activo (hora Berlin=${h}). Este script no es exento.`);
  await db.end();
  process.exit(6);
}

// Cap diario.
const capRes = await db.query(`
  SELECT (SELECT value::int FROM system_config WHERE key='wa_daily_send_cap') AS cap,
         (SELECT COUNT(*) FROM lead_timeline
            WHERE type='system_message_sent'
              AND metadata->>'channel'='whatsapp'
              AND timestamp >= (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')) AS sent
`);
const dailyCap = capRes.rows[0]?.cap ?? 300;
const sentToday = parseInt(capRes.rows[0]?.sent ?? "0", 10);
if (sentToday >= dailyCap) {
  console.error(`ABORT: cap diario ${dailyCap} alcanzado (${sentToday} enviados hoy).`);
  await db.end();
  process.exit(7);
}

// ── Send via Evolution API ──────────────────────────────────
const payload = {
  number: toNumber,
  options: { delay: 1200, presence: "composing", linkPreview: false },
  textMessage: { text },
};

console.log(`\nPOSTing to ${evolutionUrl}/message/sendText/${instance}`);
const res = await fetch(`${evolutionUrl}/message/sendText/${instance}`, {
  method:  "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey":       evolutionKey,
  },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log("HTTP", res.status);
console.log(body.slice(0, 400));

if (!res.ok) {
  console.error("SEND FAILED — check Evolution API logs.");
  await db.end();
  process.exit(3);
}
const data = JSON.parse(body);
const messageId = data?.key?.id ?? data?.messageId ?? "manual-send";

// ── Log to timeline + advance status (so agents don't re-send) ──
console.log("\nLogging to timeline + updating lead status…");

await db.query(
  `INSERT INTO lead_timeline (lead_id, type, author, content, metadata)
   VALUES ($1, 'system_message_sent', 'manual', $2, $3::jsonb)`,
  [lead.id, text, JSON.stringify({ message_id: messageId, source: "send_manual_message.mjs", reason: "scheduler_down_backfill" })],
);

// Status transition: new → contacted_1, set next_contact_date +48h
const newStatus =
  lead.status === "new"         ? "contacted_1" :
  lead.status === "contacted_1" ? "contacted_2" :
  lead.status === "contacted_2" ? "contacted_3" :
  lead.status === "contacted_3" ? "contacted_4" :
                                   lead.status;    // don't touch later stages

const nextAt = new Date(Date.now() + 48 * 3600 * 1000);

await db.query(
  `UPDATE leads SET status = $1::lead_status,
                     current_followup_number = current_followup_number + 1,
                     next_contact_date = $2
   WHERE id = $3`,
  [newStatus, nextAt.toISOString(), lead.id],
);

console.log(`✓ lead ${lead.name} → ${newStatus}, next_contact_date=${nextAt.toISOString()}`);

await db.end();
