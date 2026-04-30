import { supabaseAdmin } from "./supabase";

/**
 * Sliding-window rate limiter, Postgres-backed.
 *
 * Insert-then-count semantics:
 *   1. Insert one row in `rate_limit_log` with the current attempt.
 *   2. Count rows for (scope, key) inside the window (now − windowMs).
 *   3. If count > max → reject (the just-inserted attempt counts; we
 *      DO NOT roll it back so a flood of requests stay throttled
 *      consistently).
 *
 * Usage:
 *
 *   const r = await checkRateLimit({
 *     scope: "book_trial",
 *     key:   ipFromHeaders(req),
 *     max:   5,
 *     windowMs: 60 * 60_000,
 *   });
 *   if (!r.ok) return NextResponse.json({...}, { status: 429 });
 *
 * Returns the current count + retryAfterSeconds so the caller can
 * surface a useful error message.
 */
export type RateLimitResult =
  | { ok: true;  count: number; max: number }
  | { ok: false; count: number; max: number; retryAfterSeconds: number };

export async function checkRateLimit(args: {
  scope:    string;
  key:      string;
  max:      number;          // attempts allowed within the window
  windowMs: number;
}): Promise<RateLimitResult> {
  const { scope, key, max, windowMs } = args;
  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - windowMs).toISOString();

  // Insert the attempt first. If insert fails (DB hiccup), default to
  // letting the request through — better UX than false rejection.
  const insertRes = await sb.from("rate_limit_log").insert({ scope, key });
  if (insertRes.error) {
    console.warn("[rate-limit] insert failed, allowing through:", insertRes.error.message);
    return { ok: true, count: 0, max };
  }

  // Count attempts inside the window (including the one we just inserted).
  const countRes = await sb
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("scope", scope)
    .eq("key", key)
    .gte("created_at", cutoff);

  const count = countRes.count ?? 0;
  if (count <= max) return { ok: true, count, max };

  // Over the cap. Compute retry-after based on the OLDEST attempt
  // in the window — once that one ages out, the count drops below max.
  const oldestRes = await sb
    .from("rate_limit_log")
    .select("created_at")
    .eq("scope", scope)
    .eq("key", key)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const oldestIso = (oldestRes.data as { created_at?: string } | null)?.created_at;
  const retryAfterSeconds = oldestIso
    ? Math.max(1, Math.ceil((new Date(oldestIso).getTime() + windowMs - Date.now()) / 1000))
    : Math.ceil(windowMs / 1000);

  return { ok: false, count, max, retryAfterSeconds };
}

/**
 * Best-effort IP extraction from request headers. Vercel sets
 * `x-forwarded-for` (and `x-real-ip`); we take the first hop and
 * fall back to "unknown" so a missing header doesn't crash the
 * limiter (everyone shares the "unknown" bucket — slightly stricter,
 * but acceptable failure mode).
 */
export function ipFromHeaders(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
