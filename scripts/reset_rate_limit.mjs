#!/usr/bin/env node
/**
 * Vacía la ventana del rate limiter de book_trial para tu IP (o todas).
 *
 * Uso:
 *   node scripts/reset_rate_limit.mjs                  → limpia TODOS los buckets de book_trial
 *   node scripts/reset_rate_limit.mjs 82.145.12.34     → limpia solo esa IP
 *
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en tu .env.local
 * de la raíz o del web/.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Carga env desde web/.env.local si existe
const envPath = existsSync("web/.env.local") ? "web/.env.local" : ".env.local";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el env.");
  process.exit(1);
}

const sb = createClient(url, key);
const targetIp = process.argv[2] ?? null;

const q = sb.from("rate_limit_log").delete().eq("scope", "book_trial");
if (targetIp) q.eq("key", targetIp);
const { error, count } = await q.select("*", { count: "exact", head: true });

if (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
console.log(`✅ Limpiados ${count ?? "?"} attempts de book_trial${targetIp ? ` para IP ${targetIp}` : " (todas las IPs)"}.`);
