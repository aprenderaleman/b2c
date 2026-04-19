#!/usr/bin/env node
/**
 * Pull full recurrence detail + invitees for every real recurring meeting
 * we care about, so we can reconstruct each class series in Supabase.
 */

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

// Topic, ignore the 3 phantoms per Gelfis
const TARGETS = [
  { id: "86393586961", label: "Deutsch A1.2 Nachmittags"       },
  { id: "85833907996", label: "Fernanda Keller Deutsch B1"     },
  { id: "84238102027", label: "Deutsch A1 Abends"              },
  { id: "81635585039", label: "Deutsch A1 - B1 Morgens"        },
  { id: "87432991646", label: "Ayman Kayali"                   },
  { id: "81802815059", label: "Maria Eugenia - Deutsch B1"     },
];

// 1) token
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokenRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
);
const { access_token: token } = await tokenRes.json();

const DAYS_OF_WEEK = { 1: "Sun", 2: "Mon", 3: "Tue", 4: "Wed", 5: "Thu", 6: "Fri", 7: "Sat" };

for (const t of TARGETS) {
  console.log(`\n══ ${t.label}  (id=${t.id}) ══`);

  // Full meeting detail
  const mRes = await fetch(`https://api.zoom.us/v2/meetings/${t.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!mRes.ok) {
    console.log(`  ✗ meeting fetch failed: ${mRes.status} ${await mRes.text()}`);
    continue;
  }
  const m = await mRes.json();
  const r = m.recurrence ?? {};
  const typeLabel = { 1: "daily", 2: "weekly", 3: "monthly" }[r.type] ?? "—";
  const days      = r.weekly_days?.split(",").map(d => DAYS_OF_WEEK[d]).join("/") ?? "—";
  console.log(`  host:       ${m.host_email}`);
  console.log(`  timezone:   ${m.timezone}`);
  console.log(`  first:      ${m.start_time}  (duration ${m.duration}min)`);
  console.log(`  recurrence: ${typeLabel}  every ${r.repeat_interval ?? 1} · days=${days}`);
  console.log(`  end:        ${r.end_date_time ?? (r.end_times ? `${r.end_times} occurrences` : "open-ended")}`);
  console.log(`  join_url:   ${m.join_url}`);
  if (m.agenda) console.log(`  agenda:     ${m.agenda.slice(0,160)}`);

  // Occurrences, if present
  if (m.occurrences?.length) {
    const first = m.occurrences[0];
    const last  = m.occurrences[m.occurrences.length - 1];
    console.log(`  occurrences: ${m.occurrences.length}   ${first.start_time} → ${last.start_time}`);
  }

  // Invitees (participants with emails)
  const iRes = await fetch(`https://api.zoom.us/v2/meetings/${t.id}/invitation`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (iRes.ok) {
    const inv = await iRes.json();
    // invitation text is a multi-line string; dig for email-like lines
    const emails = [...(inv.invitation ?? "").matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map(x => x[0]);
    if (emails.length) console.log(`  invitation mentions: ${[...new Set(emails)].join(", ")}`);
  }
}
