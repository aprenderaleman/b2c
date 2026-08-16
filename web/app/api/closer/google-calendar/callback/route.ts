import { NextResponse, type NextRequest } from "next/server";
import {
  verifyCloserState,
  exchangeCloserCodeForTokens,
  upsertCloserGoogleCredentials,
} from "@/lib/closer-google-calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";

  if (error) {
    console.warn("[gcal-closer] callback error from Google:", error);
    return NextResponse.redirect(
      `${platformUrl}/closer/perfil?google_calendar=error&reason=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${platformUrl}/closer/perfil?google_calendar=error&reason=missing_params`,
    );
  }

  const verified = verifyCloserState(state);
  if (!verified) {
    return NextResponse.redirect(
      `${platformUrl}/closer/perfil?google_calendar=error&reason=invalid_state`,
    );
  }

  try {
    const tokens = await exchangeCloserCodeForTokens(code);
    await upsertCloserGoogleCredentials(verified.closerId, tokens);
    return NextResponse.redirect(`${platformUrl}/closer/perfil?google_calendar=connected`);
  } catch (e) {
    console.error("[gcal-closer] callback token exchange failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(
      `${platformUrl}/closer/perfil?google_calendar=error&reason=token_exchange_failed`,
    );
  }
}
