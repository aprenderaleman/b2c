import { NextResponse, type NextRequest } from "next/server";
import {
  verifyCloserState,
  exchangeCloserCodeForTokens,
  upsertCloserGoogleCredentials,
} from "@/lib/closer-google-calendar";
import { verifyAdminState, upsertAdminGoogleCredentials } from "@/lib/admin-google-drive";

/**
 * Callback OAuth compartido:
 *   state "c:…" → Google Calendar del closer
 *   state "a:…" → Google Drive del admin (Apuntes de Clase)
 * Ambos usan el mismo redirect_uri (GOOGLE_OAUTH_CLOSER_REDIRECT_URI).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const isAdmin = !!state?.startsWith("a:");
  const back = (q: string) => isAdmin
    ? `${platformUrl}/admin/estudiantes?google_drive=${q}`
    : `${platformUrl}/closer/perfil?google_calendar=${q}`;

  if (error) {
    console.warn("[google-oauth] callback error from Google:", error);
    return NextResponse.redirect(back(`error&reason=${encodeURIComponent(error)}`));
  }
  if (!code || !state) {
    return NextResponse.redirect(back("error&reason=missing_params"));
  }

  if (isAdmin) {
    const verified = verifyAdminState(state);
    if (!verified) return NextResponse.redirect(back("error&reason=invalid_state"));
    try {
      const tokens = await exchangeCloserCodeForTokens(code);
      await upsertAdminGoogleCredentials(verified.adminId, tokens);
      return NextResponse.redirect(back("connected"));
    } catch (e) {
      console.error("[admin-drive] callback token exchange failed:", e instanceof Error ? e.message : e);
      return NextResponse.redirect(back("error&reason=token_exchange_failed"));
    }
  }

  const verified = verifyCloserState(state);
  if (!verified) {
    return NextResponse.redirect(back("error&reason=invalid_state"));
  }

  try {
    const tokens = await exchangeCloserCodeForTokens(code);
    await upsertCloserGoogleCredentials(verified.closerId, tokens);
    return NextResponse.redirect(back("connected"));
  } catch (e) {
    console.error("[gcal-closer] callback token exchange failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(back("error&reason=token_exchange_failed"));
  }
}
