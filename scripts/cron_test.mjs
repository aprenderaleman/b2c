#!/usr/bin/env node
/**
 * End-to-end test of the Vercel Cron setup. Reads CRON_SECRET from
 * .cron-secret.local (written by set_vercel_envs.mjs the last time it
 * generated the secret) and POSTs to both cron endpoints.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");
const ORIGIN  = process.env.ORIGIN ?? "https://b2c.aprender-aleman.de";

const secretPath = path.join(repoRoot, ".cron-secret.local");
if (!fs.existsSync(secretPath)) {
  console.error(".cron-secret.local not found. Run scripts/set_vercel_envs.mjs first.");
  process.exit(1);
}
const secret = fs.readFileSync(secretPath, "utf8").trim();
console.log("CRON_SECRET length:", secret.length);
const cron = { value: secret };

const cr = await fetch(`${ORIGIN}/api/cron/class-reminders`, {
  method:  "POST",
  headers: { "X-Cron-Secret": cron.value },
});
console.log("\nclass-reminders → HTTP", cr.status);
const body = await cr.text();
console.log("body:", body.slice(0, 400));

console.log("\ndaily-digest dry-run:");
const dd = await fetch(`${ORIGIN}/api/cron/daily-digest`, {
  method:  "POST",
  headers: { "X-Cron-Secret": cron.value },
});
console.log("HTTP", dd.status);
const ddBody = await dd.text();
console.log("body:", ddBody.slice(0, 400));
