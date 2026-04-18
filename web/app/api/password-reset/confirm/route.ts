import { NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordResetToken } from "@/lib/password-reset";

const Body = z.object({
  token:       z.string().min(10).max(200),
  newPassword: z.string().min(8).max(200),
});

/**
 * POST /api/password-reset/confirm
 *
 * Atomically verifies the token, updates the user's password, marks
 * the token as used. Returns 200 { ok: true } or 400/410 with a
 * reason code that the client surfaces.
 */
export async function POST(req: Request) {
  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const r = await consumePasswordResetToken(parsed.data.token, parsed.data.newPassword);
    if (!r.ok) {
      const status = r.reason === "expired" || r.reason === "already_used" ? 410 : 400;
      return NextResponse.json({ error: r.reason }, { status });
    }
    return NextResponse.json({ ok: true, email: r.email });
  } catch (e) {
    console.error("password-reset/confirm failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
