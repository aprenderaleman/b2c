import { NextResponse, type NextRequest } from "next/server";
import {
  verifyState,
  exchangeCodeForTokens,
  upsertTeacherGoogleCredentials,
} from "@/lib/google-calendar-oauth";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";

  if (error) {
    console.warn("[gcal-oauth] callback error from Google:", error);
    return NextResponse.redirect(
      `${platformUrl}/profesor?google_calendar=error&reason=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${platformUrl}/profesor?google_calendar=error&reason=missing_params`,
    );
  }

  const verified = verifyState(state);
  if (!verified) {
    return NextResponse.redirect(
      `${platformUrl}/profesor?google_calendar=error&reason=invalid_state`,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await upsertTeacherGoogleCredentials(verified.teacherId, tokens);
    return NextResponse.redirect(`${platformUrl}/profesor?google_calendar=connected`);
  } catch (e) {
    console.error("[gcal-oauth] callback token exchange failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(
      `${platformUrl}/profesor?google_calendar=error&reason=token_exchange_failed`,
    );
  }
}
