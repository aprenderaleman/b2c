#!/usr/bin/env node
/**
 * Registrar en lead_timeline las 4 confirmaciones de WhatsApp que Gelfis
 * envió manualmente tras el caída de aa-agents.service.
 *
 * Append-only — los send_failed se quedan como auditoría histórica.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const LEADS = [
  { id: "e46a9cf6", name: "bayron" },
  { id: "0c1e6db2", name: "Jose jose barros ramos" },
  { id: "9e67eecb", name: "Alice Redfern" },
  { id: "3fae64a1", name: "Aprender" },
];

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("BEGIN");

try {
  for (const lead of LEADS) {
    // Resolver el UUID completo del lead
    const { rows: [full] } = await db.query(
      `SELECT id, name FROM leads WHERE id::text LIKE $1 LIMIT 1`,
      [`${lead.id}%`],
    );
    if (!full) {
      console.log(`  ✗ no encontrado lead ${lead.id} (${lead.name})`);
      continue;
    }
    await db.query(
      `INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
       VALUES ($1, 'system_message_sent', 'gelfis',
               '💬 WhatsApp de confirmación enviado manualmente por Gelfis (recovery tras caída de aa-agents.service 24-abr→29-abr)',
               NOW())`,
      [full.id],
    );
    console.log(`  ✓ ${full.id.slice(0,8)}  ${full.name}`);
  }

  await db.query("COMMIT");
  console.log("\n✓ COMMIT — 4 entradas system_message_sent añadidas (los send_failed se quedan como auditoría).");
} catch (e) {
  await db.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
}

await db.end();
