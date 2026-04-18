#!/usr/bin/env node
const TOKEN   = process.env.VERCEL_TOKEN;
const TEAM    = "team_ZY7wa1mqrWh5deiwmIwWWOa8";
const PROJECT = "prj_582Aq1uCPj2zxuuDr31UjhvXZWxh";

const res = await fetch(
  `https://api.vercel.com/v9/projects/${PROJECT}/env?teamId=${TEAM}&decrypt=true`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
);
const data = await res.json();
const all = data.envs.filter(e => e.key === "CRON_SECRET");
for (const e of all) {
  console.log("=== entry ===");
  console.log("  id:", e.id);
  console.log("  target:", e.target);
  console.log("  type:", e.type);
  console.log("  createdAt:", new Date(e.createdAt).toISOString());
  console.log("  value type:", typeof e.value);
  console.log("  value (first 100):", String(e.value).slice(0, 100));
  console.log("  value length:", String(e.value).length);
}
