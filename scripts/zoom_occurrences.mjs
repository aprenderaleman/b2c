#!/usr/bin/env node
/** Print every occurrence of each recurring meeting, grouped by weekday/time. */
const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

const TARGETS = [
  { id: "86393586961", label: "Deutsch A1.2 Nachmittags"       },
  { id: "85833907996", label: "Fernanda Keller Deutsch B1"     },
  { id: "84238102027", label: "Deutsch A1 Abends"              },
  { id: "81635585039", label: "Deutsch A1 - B1 Morgens"        },
  { id: "87432991646", label: "Ayman Kayali"                   },
  { id: "81802815059", label: "Maria Eugenia - Deutsch B1"     },
];

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
const { access_token: token } = await tokRes.json();

const NOW = new Date();
const fmt = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Berlin",
  weekday: "short", hour: "2-digit", minute: "2-digit",
});

for (const t of TARGETS) {
  const mRes = await fetch(`https://api.zoom.us/v2/meetings/${t.id}?show_previous_occurrences=false`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!mRes.ok) continue;
  const m = await mRes.json();
  console.log(`\n══ ${t.label} ══   dur=${m.duration}min tz=${m.timezone}`);

  if (!m.occurrences?.length) {
    console.log("  (no occurrences — open-ended booking)");
    continue;
  }

  // Bucket by (weekday, Berlin-local HH:MM)
  const buckets = new Map();
  for (const o of m.occurrences) {
    const dt = new Date(o.start_time);
    const key = fmt.format(dt);           // e.g. "lun., 09:00"
    const b = buckets.get(key) ?? { key, count: 0, first: null, last: null, dur: 0 };
    b.count++;
    b.dur = o.duration ?? b.dur;
    if (!b.first || dt < new Date(b.first)) b.first = o.start_time;
    if (!b.last  || dt > new Date(b.last))  b.last  = o.start_time;
    buckets.set(key, b);
  }

  const futureOccurrences = m.occurrences.filter(o => new Date(o.start_time) >= NOW);
  console.log(`  total=${m.occurrences.length}  future=${futureOccurrences.length}`);
  if (futureOccurrences.length === 0 && m.occurrences.length > 0) {
    const lastDate = m.occurrences[m.occurrences.length - 1].start_time;
    console.log(`  ⚠️  all occurrences in the past — last was ${lastDate}`);
  }

  const rows = [...buckets.values()].sort((a,b) => a.key.localeCompare(b.key));
  for (const b of rows) {
    console.log(`  • ${b.key.padEnd(14)}  ${String(b.dur).padStart(3)}min  n=${String(b.count).padStart(3)}  ${b.first?.slice(0,10)} → ${b.last?.slice(0,10)}`);
  }
}
