#!/usr/bin/env node
/**
 * Probe Zoom Server-to-Server OAuth access. Steps:
 *   1. Exchange (accountId, clientId, clientSecret) for a Bearer token.
 *   2. Call /users to list all hosts (teachers).
 *   3. For each host, call /users/{id}/meetings?type=scheduled — list their
 *      scheduled + recurring classes.
 *
 * Read-only, no writes anywhere.
 */

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

// --- 1) Get access token
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokenRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
);
if (!tokenRes.ok) {
  console.error("✗ token exchange failed:", tokenRes.status, await tokenRes.text());
  process.exit(1);
}
const tokenJson = await tokenRes.json();
const token = tokenJson.access_token;
console.log(`✓ access token obtained (scope: ${tokenJson.scope}) — expires in ${tokenJson.expires_in}s\n`);

// --- 2) List users (hosts)
const usersRes = await fetch("https://api.zoom.us/v2/users?page_size=100&status=active", {
  headers: { Authorization: `Bearer ${token}` },
});
if (!usersRes.ok) {
  console.error("✗ /users failed:", usersRes.status, await usersRes.text());
  process.exit(1);
}
const { users } = await usersRes.json();
console.log(`Hosts in this Zoom account: ${users.length}`);
for (const u of users) {
  console.log(`  • ${u.first_name ?? ""} ${u.last_name ?? ""}  <${u.email}>   id=${u.id}   type=${u.type}`);
}

// --- 3) For each host, list scheduled meetings (gives us recurring masters too)
for (const u of users) {
  console.log(`\n── meetings for ${u.email} ──`);
  const mRes = await fetch(
    `https://api.zoom.us/v2/users/${u.id}/meetings?type=scheduled&page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!mRes.ok) {
    console.log(`  ✗ error: ${mRes.status} ${await mRes.text()}`);
    continue;
  }
  const data = await mRes.json();
  const meetings = data.meetings ?? [];
  if (meetings.length === 0) {
    console.log("  (no scheduled meetings)");
    continue;
  }
  for (const m of meetings) {
    const recur = m.type === 8 ? "recurring" : m.type === 3 ? "recurring-no-fixed" : "one-off";
    console.log(`  • "${m.topic}"`);
    console.log(`      id=${m.id}  type=${recur}  start=${m.start_time ?? "—"}  duration=${m.duration}min  tz=${m.timezone ?? "—"}`);
  }
}
