#!/usr/bin/env node
/**
 * One-off: queue the two student reminder broadcasts for
 *   2026-04-27 06:04:00 UTC  =  2026-04-27 08:04 Europe/Madrid
 *
 * The dispatch cron runs every 5 minutes (xx:00, xx:05, ...). Picking
 * 06:04 UTC guarantees the 06:05 UTC tick claims the rows, so students
 * receive the messages right at 8:05 Madrid time.
 *
 * Idempotent: re-running won't duplicate. We tag both rows with a
 * unique marker inside audience_filter (`_marker`) and bail if the
 * marker already exists for this date.
 *
 * Audience: Estudiantes activos. Same filter for both rows.
 *
 * Run:  node scripts/queue_comunicados_2026_04_27.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require   = createRequire(import.meta.url);
const pg        = require("pg");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");

// ---------- env loader (mirrors apply_migrations.mjs) ----------
const envPath = path.join(repoRoot, ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}
if (!env.DATABASE_URL) { console.error("DATABASE_URL missing in .env"); process.exit(1); }
const adminEmail = env.ADMIN_EMAIL || "aprenderaleman2026@gmail.com";

// ---------- payload ----------
const SCHEDULED_AT_UTC = "2026-04-27 06:04:00+00";   // = 08:04 Europe/Madrid → cron tick at 08:05 picks up
const MARKER           = "reminder-platform-schule-2026-04-27";

const audienceFilter = {
  kind:     "all_students",
  status:   "active",
  _marker:  MARKER,
};

const emailRow = {
  subject:  "Recordatorio: esta semana empezamos en la nueva plataforma 📚",
  channels: ["email"],
  markdown: [
    "Te escribo para recordarte que **esta semana empezamos a dar clase en la nueva plataforma de la academia** y dejamos atrás Zoom. 🚀",
    "",
    "**Lo que necesitas hacer antes de tu primera clase:**",
    "",
    "- **Entra y prueba la plataforma con calma**, antes de que empiece tu clase. Mira el aula virtual, los materiales, el chat con tu profesor/a y las grabaciones. Así llegas a clase tranquilo/a, sin sorpresas y sabiendo dónde está cada cosa.",
    "- **Completa los ejercicios de tu nivel en SCHULE.** Es importante que mantengas el ritmo de práctica entre clases — los ejercicios refuerzan exactamente lo que vamos viendo y notarás muchísimo la diferencia en clase.",
    "",
    "**Tus accesos:**",
    "",
    "- 🔐 Plataforma de clases: [b2c.aprender-aleman.de/login](https://b2c.aprender-aleman.de/login)",
    "- 📚 Ejercicios SCHULE: [schule.aprender-aleman.de](https://schule.aprender-aleman.de)",
    "- **Usuario:** tu email (el mismo de este correo).",
    "- **Contraseña:** la de siempre de la academia. Si no la recuerdas, pulsa **\"Olvidé mi contraseña\"** en el login y te llegará el enlace al instante.",
    "",
    "Si todavía no has visto el vídeo donde te explico paso a paso cómo funciona la plataforma, aquí lo tienes:",
    "",
    "[🎥 Ver el vídeo explicativo](https://www.youtube.com/watch?v=pU2SV_ZAIoY)",
    "",
    "Cualquier duda, me escribes por WhatsApp o respondes a este mismo email — te ayudo al momento.",
    "",
    "¡Nos vemos esta semana en la plataforma!",
    "",
    "Un abrazo,",
    "— Gelfis",
  ].join("\n"),
};

const whatsappRow = {
  subject:  "Recordatorio plataforma + SCHULE",
  channels: ["whatsapp"],
  markdown: [
    "Recordatorio: **esta semana empezamos en la nueva plataforma** y dejamos Zoom. 🚀",
    "",
    "Dos cosas importantes antes de tu próxima clase:",
    "",
    "1. **Entra y prueba la plataforma** para familiarizarte:",
    "https://b2c.aprender-aleman.de/login",
    "",
    "2. **Completa los ejercicios de tu nivel en SCHULE**:",
    "https://schule.aprender-aleman.de",
    "",
    "En ambas usas tu email y la contraseña de la academia. Si no la recuerdas, pulsa *\"Olvidé mi contraseña\"* en el login.",
    "",
    "Si no viste el vídeo explicativo:",
    "https://www.youtube.com/watch?v=pU2SV_ZAIoY",
    "",
    "Cualquier duda, me escribes.",
    "",
    "— Gelfis",
  ].join("\n"),
};

// ---------- main ----------
const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();

try {
  // Idempotency: bail if rows with this marker already exist.
  const dup = await c.query(
    "SELECT id, channels, scheduled_at, status FROM admin_broadcasts WHERE audience_filter->>'_marker' = $1",
    [MARKER],
  );
  if (dup.rowCount > 0) {
    console.log("Already queued — nothing to do:");
    for (const r of dup.rows) {
      console.log(`  ${r.id}  ${r.channels}  ${r.scheduled_at.toISOString()}  status=${r.status}`);
    }
    process.exit(0);
  }

  // Find Gelfis's user_id (admin signature on the rows).
  const adminRes = await c.query(
    "SELECT id FROM users WHERE email = $1 AND role IN ('admin','superadmin') LIMIT 1",
    [adminEmail],
  );
  const adminUserId = adminRes.rows[0]?.id ?? null;
  if (!adminUserId) {
    console.warn(`Warning: no admin user found for ${adminEmail}; admin_user_id will be NULL`);
  }

  for (const row of [emailRow, whatsappRow]) {
    const ins = await c.query(
      `INSERT INTO admin_broadcasts
         (admin_user_id, audience_filter, subject, message_markdown, channels,
          total_recipients, ok_count, fail_count, results,
          scheduled_at, status)
       VALUES ($1, $2::jsonb, $3, $4, $5, 0, 0, 0, '[]'::jsonb, $6::timestamptz, 'queued')
       RETURNING id, scheduled_at, status, channels`,
      [
        adminUserId,
        JSON.stringify(audienceFilter),
        row.subject,
        row.markdown,
        row.channels,
        SCHEDULED_AT_UTC,
      ],
    );
    const r = ins.rows[0];
    console.log(`✓ queued  ${r.id}  channels=${r.channels}  scheduled_at=${r.scheduled_at.toISOString()}  status=${r.status}`);
  }

  console.log("");
  console.log("Done. Cron tick at 06:05 UTC (08:05 Madrid) will pick these up.");
} finally {
  await c.end();
}
