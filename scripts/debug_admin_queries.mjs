#!/usr/bin/env node
/** Reproduce the queries that /admin runs, to find what crashes. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function test(label, fn) {
  process.stdout.write(label.padEnd(55));
  try {
    const r = await fn();
    if (r?.error) console.log("  ✗", r.error.message);
    else console.log("  ✓", Array.isArray(r?.data) ? `${r.data.length} rows` : "ok");
  } catch (e) {
    console.log("  ✗ threw:", e.message);
  }
}

// getStudentsAttendance query (first half of computeRiskAlerts)
await test("getStudentsAttendance query", async () =>
  await sb
    .from("class_participants")
    .select(`
      student_id, attended,
      class:classes!inner(scheduled_at, status),
      student:students!inner(
        current_level,
        users!inner(full_name, email)
      )
    `)
    .gte("class.scheduled_at", new Date(Date.now() - 30 * 86400000).toISOString())
    .lte("class.scheduled_at", new Date(Date.now() - 3600000).toISOString())
    .in("class.status", ["completed", "absent", "live"])
);

// Two consecutive absences query (second half)
await test("two-absences query (with class.scheduled_at order)", async () =>
  await sb
    .from("class_participants")
    .select(`
      student_id, attended,
      class:classes!inner(scheduled_at),
      student:students!inner(users!inner(full_name, email))
    `)
    .in("attended", [true, false])
    .order("scheduled_at", { ascending: false, foreignTable: "classes" })
    .limit(800)
);

// inactive_14d students query
await test("inactive students query", async () =>
  await sb
    .from("students")
    .select(`
      id, converted_at,
      users!inner(full_name, email, last_login_at)
    `)
    .eq("subscription_status", "active")
);

// Dashboard 'Hoy' queries
await test("getTodaysTrials", async () => {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(s.getTime() + 86400000);
  return await sb.from("leads").select("*")
    .in("status", ["trial_scheduled", "trial_reminded"])
    .gte("trial_scheduled_at", s.toISOString())
    .lt("trial_scheduled_at", e.toISOString())
    .order("trial_scheduled_at", { ascending: true });
});

await test("getLeadsNeedingHuman (leads with status='needs_human')", async () =>
  await sb.from("leads").select("*").eq("status", "needs_human")
);

await test("getStaleConversations (status in convo + no_move 48h)", async () => {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
  return await sb.from("leads").select("*")
    .in("status", ["in_conversation", "link_sent"])
    .lt("last_message_seen_at", cutoff.toISOString());
});

await test("quick stats: new leads today", async () => {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  return await sb.from("leads").select("id", { count: "exact", head: true })
    .gte("created_at", s.toISOString());
});
