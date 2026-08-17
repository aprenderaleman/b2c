#!/usr/bin/env node
/**
 * One-off: shorten the queued WhatsApp reminder to a tight version
 *           (b2c login link only).
 *
 * Targets the row with id 2636b24c-37af-4c87-8b31-ecb810766820 — the
 * WhatsApp half of the 2026-04-27 student reminders. Verifies the row
 * is still 'queued' before updating so we don't accidentally rewrite a
 * message that already went out.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require   = createRequire(import.meta.url);
const pg        = require("pg");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");

const env = {};
for (const line of fs.readFileSync(path.join(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const ROW_ID = "2636b24c-37af-4c87-8b31-ecb810766820";

const NEW_MARKDOWN = [
  "Recordatorio: esta semana estrenamos la nueva plataforma. 🚀",
  "",
  "Entra antes de tu próxima clase para familiarizarte:",
  "https://b2c.aprender-aleman.de/login",
  "",
  "Usa tu email y la contraseña de siempre. Si no la recuerdas, pulsa *\"Olvidé mi contraseña\"*.",
].join("\n");

const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
try {
  const upd = await c.query(
    `UPDATE admin_broadcasts
        SET message_markdown = $1
      WHERE id = $2 AND status = 'queued'
      RETURNING id, status, scheduled_at, channels, message_markdown`,
    [NEW_MARKDOWN, ROW_ID],
  );
  if (upd.rowCount === 0) {
    console.error("Row not found OR no longer queued. Aborting.");
    const peek = await c.query("SELECT id, status, scheduled_at FROM admin_broadcasts WHERE id = $1", [ROW_ID]);
    console.error("Current state:", peek.rows[0] ?? "(missing)");
    process.exit(1);
  }
  const r = upd.rows[0];
  console.log(`✓ updated  ${r.id}  channels=${r.channels}  scheduled_at=${r.scheduled_at.toISOString()}  status=${r.status}`);
  console.log("\nNew body:\n");
  console.log(r.message_markdown);
} finally {
  await c.end();
}
