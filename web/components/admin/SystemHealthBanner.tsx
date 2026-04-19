import { supabaseAdmin } from "@/lib/supabase";

const STALE_HEARTBEAT_MIN = 30;

type Beat = { service: string; last_tick: string; last_note: string | null };

/**
 * Loud red banner across the top of every admin page when the self-healing
 * janitor leaves a critical-issue flag, or when a service's heartbeat has
 * gone quiet beyond its threshold. Reads live — no caching.
 */
export async function SystemHealthBanner() {
  const sb = supabaseAdmin();

  // 1. Janitor-set critical issue (takes priority; usually user-facing wording).
  const { data: cfgRows } = await sb
    .from("system_config")
    .select("key, value")
    .eq("key", "last_critical_issue")
    .maybeSingle();
  const critical = (cfgRows?.value as string | undefined)?.trim() ?? "";

  // 2. Heartbeat freshness — second line of defence in case the janitor itself
  //    is the one that died.
  const { data: beats } = await sb
    .from("system_heartbeat")
    .select("service, last_tick, last_note");

  const stale: Beat[] = [];
  const now = Date.now();
  for (const b of (beats ?? []) as Beat[]) {
    const age = (now - new Date(b.last_tick).getTime()) / 60_000;
    if (age > STALE_HEARTBEAT_MIN) stale.push(b);
  }

  if (!critical && stale.length === 0) return null;

  return (
    <div className="sticky top-14 z-30 border-b border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-900 dark:text-red-200 text-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-start gap-3">
        <span className="text-lg leading-none" aria-hidden>🚨</span>
        <div className="flex-1 min-w-0">
          {critical && (
            <div className="font-medium break-words">{stripTimestamp(critical)}</div>
          )}
          {stale.length > 0 && (
            <div className={critical ? "mt-1 text-xs" : "text-sm"}>
              Heartbeat caído en: {stale.map(s => s.service).join(", ")}{" "}
              (hace &gt;{STALE_HEARTBEAT_MIN} min).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Trim the leading ISO timestamp we prepend in agents/shared/heartbeat.py. */
function stripTimestamp(s: string): string {
  const i = s.indexOf("|");
  return i > 0 ? s.slice(i + 1).trim() : s;
}
