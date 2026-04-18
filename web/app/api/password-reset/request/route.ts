import { NextResponse } from "next/server";
import { z } from "zod";
import { issuePasswordResetToken } from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/email/send";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/**
 * POST /api/password-reset/request
 *
 * Always 200s regardless of whether the email exists — we never reveal
 * account existence. The email is only actually sent if a matching
 * active user is found.
 */
export async function POST(req: Request) {
  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ ok: true }); }   // invalid JSON → still 200

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ ok: true });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  const baseUrl =
    process.env.PLATFORM_URL ??
    new URL(req.url).origin;

  try {
    const result = await issuePasswordResetToken(parsed.data.email, baseUrl, ip);
    if (result.user && result.resetUrl) {
      await sendPasswordResetEmail(result.user.email, {
        name:           result.user.full_name,
        resetUrl:       result.resetUrl,
        expiresInHours: result.expiresInHours,
        language:       result.user.language_preference,
      });
    }
  } catch (e) {
    // Log but still return 200 — we don't want errors to leak existence.
    console.error("password-reset/request failed:", e);
  }

  return NextResponse.json({ ok: true });
}
