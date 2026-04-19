#!/usr/bin/env node
/**
 * Recon of past meeting instances + participants for ONE recurring meeting
 * (Ayman Kayali, small enough to read). Goal: verify the API shape, the
 * duration field, and whether participant emails come through usable.
 */
const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

const MEETING_ID = "87432991646";  // Ayman Kayali

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
const { access_token: token } = await tokRes.json();

// Zoom UUIDs may contain / and = — must be double-encoded when they do.
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) {
    return encodeURIComponent(encodeURIComponent(uuid));
  }
  return encodeURIComponent(uuid);
}

// 1) List past instances
const listRes = await fetch(
  `https://api.zoom.us/v2/past_meetings/${MEETING_ID}/instances`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!listRes.ok) {
  console.error("✗ list instances failed:", listRes.status, await listRes.text());
  process.exit(1);
}
const { meetings: instances } = await listRes.json();
console.log(`Past instances of ${MEETING_ID}: ${instances.length}\n`);

// Show first 5 and last 5
const preview = instances.length <= 10 ? instances : [...instances.slice(0,5), null, ...instances.slice(-5)];
for (const i of preview) {
  if (i === null) { console.log("  … (snip) …"); continue; }
  console.log(`  • start=${i.start_time}  uuid=${i.uuid}`);
}

// 2) For the MOST RECENT 3 past instances, pull details + participants
const recent = instances.slice(-3);
for (const inst of recent) {
  const uuid = encodeUuid(inst.uuid);
  console.log(`\n── instance ${inst.start_time} ──`);

  // Details (gives the real duration)
  const detRes = await fetch(
    `https://api.zoom.us/v2/past_meetings/${uuid}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!detRes.ok) {
    console.log(`  ✗ details: ${detRes.status} ${await detRes.text()}`);
  } else {
    const d = await detRes.json();
    console.log(`  start=${d.start_time}  end=${d.end_time}  duration=${d.duration}min  participants_count=${d.participants_count}`);
  }

  // Participants
  const pRes = await fetch(
    `https://api.zoom.us/v2/past_meetings/${uuid}/participants?page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!pRes.ok) {
    console.log(`  ✗ participants: ${pRes.status} ${await pRes.text()}`);
  } else {
    const p = await pRes.json();
    console.log(`  participants (${p.participants.length}):`);
    for (const person of p.participants) {
      console.log(`    - ${person.name.padEnd(28)} <${person.user_email || "—"}>  in=${person.join_time}  out=${person.leave_time}  dur=${person.duration}s`);
    }
  }
}
