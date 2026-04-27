#!/usr/bin/env node
/**
 * Set required Vercel environment variables on the b2c project.
 * Idempotent — skips values that already exist with the same value.
 *
 * Does NOT set secrets that require external services (RESEND_API_KEY,
 * LIVEKIT_*, AGENTS_INTERNAL_SECRET). Those are left for Gelfis.
 */

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");

// Fill these from your environment before running:
//   VERCEL_TOKEN      — OAuth/CLI token (~/.local/share/com.vercel.cli/Data/auth.json)
//   VERCEL_TEAM_ID    — e.g. team_xxxxx
//   VERCEL_PROJECT_ID — e.g. prj_xxxxx
const TOKEN   = process.env.VERCEL_TOKEN;
const TEAM    = process.env.VERCEL_TEAM_ID    ?? "team_ZY7wa1mqrWh5deiwmIwWWOa8";
const PROJECT = process.env.VERCEL_PROJECT_ID ?? "prj_582Aq1uCPj2zxuuDr31UjhvXZWxh";   // b2c
const BASE    = `https://api.vercel.com`;

if (!TOKEN) {
  console.error("VERCEL_TOKEN env var is required. See ~/AppData/Roaming/com.vercel.cli/Data/auth.json");
  process.exit(1);
}

// Load existing .env so we can mirror values (ADMIN_*, SUPABASE_*, etc.)
const envPath = path.join(repoRoot, ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

// Generate a CRON_SECRET if not already set.
const cronSecret = crypto.randomBytes(48).toString("base64");

// Env vars we own and can set cleanly.
// Each entry = { key, value, target (production | preview | development), type }
const desired = [
  // Already in Vercel but add/update idempotently:
  { key: "PLATFORM_URL",        value: "https://live.aprender-aleman.de",                        targets: ["production", "preview", "development"] },
  { key: "HANS_URL",            value: "https://hans.aprender-aleman.de",                        targets: ["production", "preview", "development"] },
  { key: "SCHULE_URL",          value: "https://schule.aprender-aleman.de",                      targets: ["production", "preview", "development"] },
  { key: "EMAIL_FROM",          value: "Aprender-Aleman.de <info@aprender-aleman.de>",           targets: ["production", "preview", "development"] },
  { key: "DIGEST_RECIPIENT",    value: env.ADMIN_EMAIL || "info@aprender-aleman.de",             targets: ["production"] },
  { key: "CRON_SECRET",         value: cronSecret,                                               targets: ["production", "preview", "development"] },
];

async function listVars() {
  const url = `${BASE}/v9/projects/${PROJECT}/env?teamId=${TEAM}&decrypt=false`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.envs ?? [];
}

async function deleteVar(id) {
  const url = `${BASE}/v9/projects/${PROJECT}/env/${id}?teamId=${TEAM}`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
}

async function createVar({ key, value, targets, sensitive }) {
  const url = `${BASE}/v10/projects/${PROJECT}/env?teamId=${TEAM}`;
  const body = {
    key,
    value,
    type: sensitive ? "sensitive" : "encrypted",
    target: targets,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create ${key} failed: ${res.status} ${t}`);
  }
}

async function main() {
  console.log("Fetching existing env vars…");
  const existing = await listVars();
  console.log(`  → ${existing.length} existing`);

  for (const d of desired) {
    // Delete any existing entries for this key so we can overwrite cleanly.
    const matches = existing.filter(e => e.key === d.key);
    for (const m of matches) {
      console.log(`  - delete ${d.key} (id=${m.id})`);
      await deleteVar(m.id);
    }
    console.log(`  + set ${d.key} for [${d.targets.join(",")}]`);
    await createVar(d);
  }

  // Persist the generated CRON_SECRET locally so smoke-tests can read it.
  // .cron-secret.local is in .gitignore.
  const outPath = path.join(repoRoot, ".cron-secret.local");
  fs.writeFileSync(outPath, cronSecret + "\n");
  console.log(`\nDone. CRON_SECRET (${cronSecret.length} chars) written to .cron-secret.local`);
  console.log("\nNOTE: not set here (need Gelfis input):");
  console.log("  - RESEND_API_KEY        (after Resend account + DNS)");
  console.log("  - AGENTS_BASE_URL       (https://agents.aprender-aleman.de if same)");
  console.log("  - AGENTS_INTERNAL_SECRET (matches VPS .env.prod)");
  console.log("  - LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (after VPS setup)");
}

main().catch(e => { console.error(e); process.exit(1); });
