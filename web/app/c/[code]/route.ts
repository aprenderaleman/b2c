import { NextResponse } from "next/server";
import { TRIAL_COOKIE, buildTrialToken } from "@/lib/trial-token";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /c/{code}
 *
 * Short magic-link entry. Looks up the trial class by its `short_code`
 * (an opaque 8-char alias generated at booking time so we don't have
 * to send a 250-char signed JWT over WhatsApp). Reissues a fresh
 * trial token, sets the `aa_trial_session` cookie on the redirect
 * response, and sends the lead to /aula/{classId}.
 *
 * Why reissue a token instead of storing one? The `short_code` IS
 * the magic credential. We trust the DB lookup the same way we'd
 * trust an HMAC verify. The cookie still holds a signed token so the
 * downstream aula auth check (lib/aula.ts → cookie verify) works
 * unchanged.
 *
 * Errors → /trial-expired?reason=... (same friendly screen used by
 * /trial/[classId]).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function expiredRedirect(req: Request, reason: string): NextResponse {
  const url = new URL(`/trial-expired?reason=${encodeURIComponent(reason)}`, req.url);
  return NextResponse.redirect(url);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!code || code.length < 4 || code.length > 32) {
    return expiredRedirect(req, "unknown_code");
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, is_trial, status, scheduled_at")
    .eq("short_code", code)
    .maybeSingle();

  if (!cls) return expiredRedirect(req, "unknown_code");
  const c = cls as {
    id: string;
    lead_id: string | null;
    is_trial: boolean;
    status: string;
    scheduled_at: string;
  };

  if (!c.is_trial)              return expiredRedirect(req, "not_a_trial");
  if (!c.lead_id)               return expiredRedirect(req, "lead_mismatch");
  if (c.status === "cancelled") return expiredRedirect(req, "class_cancelled");

  // Refuse to issue a fresh session a long time after the class. The
  // aula route also enforces a join window, but stopping here keeps
  // stale shortlinks from being usable forever.
  const ageDays = (Date.now() - new Date(c.scheduled_at).getTime()) / 86_400_000;
  if (ageDays > 30) return expiredRedirect(req, "bad_or_expired");

  const token = buildTrialToken(c.lead_id, c.id);
  const aulaUrl = new URL(`/aula/${c.id}`, req.url);
  const res = NextResponse.redirect(aulaUrl);
  // 7-day cookie matches buildTrialToken's TTL.
  res.cookies.set(TRIAL_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   7 * 24 * 3600,
  });
  return res;
}
