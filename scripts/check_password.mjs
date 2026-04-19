#!/usr/bin/env node
/** Quick compare: do any of our guess candidates match the stored hash? */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

const hash = env.ADMIN_PASSWORD_HASH;
const candidates = [
  process.argv[2],                // optional CLI arg
  "H2310994h!",                   // Supabase password you shared earlier
].filter(Boolean);

for (const c of candidates) {
  const ok = await bcrypt.compare(c, hash);
  console.log(`  ${ok ? "✓ MATCH" : "✗ no match"}: "${c}"`);
}
