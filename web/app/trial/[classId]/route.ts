import { NextResponse } from "next/server";
import { TRIAL_COOKIE, verifyTrialToken } from "@/lib/trial-token";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /trial/{classId}?t={signed_token}
 *
 * Magic-link entry point for trial-class leads. We use a Route Handler
 * (not a Server Component / page.tsx) because Next.js 15 forbids
 * mutating cookies during a Server Component render — that's what was
 * crashing this route in production with digest 2926876529.
 *
 * Flow:
 *   1. Validate the HMAC token (lib/trial-token.ts).
 *   2. Confirm the class exists, IS a trial, lead_id matches, status
 *      is not cancelled.
 *   3. Set the `aa_trial_session` cookie on the redirect response so
 *      the aula route can authorise without a real user account.
 *   4. Redirect to /aula/{classId} — the existing room flow handles
 *      the open/closed time window from there.
 *
 * Errors → redirect to /trial-expired?reason=... so the lead lands on
 * a friendly screen instead of seeing a 5xx.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function expiredRedirect(req: Request, reason: string): NextResponse {
  const url = new URL(`/trial-expired?reason=${encodeURIComponent(reason)}`, req.url);
  return NextResponse.redirect(url);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ classId: string }> },
) {
  const { classId } = await params;
  const url = new URL(req.url);
  const t = url.searchParams.get("t");

  if (!t) return expiredRedirect(req, "missing_token");

  const payload = verifyTrialToken(t);
  if (!payload) return expiredRedirect(req, "bad_or_expired");
  if (payload.class_id !== classId) return expiredRedirect(req, "mismatched_class");

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, is_trial, status")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return expiredRedirect(req, "class_missing");
  const c = cls as { lead_id: string | null; is_trial: boolean; status: string };
  if (!c.is_trial)                    return expiredRedirect(req, "not_a_trial");
  if (c.lead_id !== payload.lead_id)  return expiredRedirect(req, "lead_mismatch");
  if (c.status === "cancelled")       return expiredRedirect(req, "class_cancelled");

  // Cookie value is the same signed token we just verified — no need
  // to re-encode. The aula auth check decodes it again from the cookie.
  const aulaUrl = new URL(`/aula/${classId}`, req.url);
  const res = NextResponse.redirect(aulaUrl);
  res.cookies.set(TRIAL_COOKIE, t, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   Math.max(60, Math.floor((payload.exp - Date.now()) / 1000)),
  });
  return res;
}
