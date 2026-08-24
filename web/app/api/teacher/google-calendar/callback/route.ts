import { NextResponse, after, type NextRequest } from "next/server";
import {
  verifyState,
  exchangeCodeForTokens,
  upsertTeacherGoogleCredentials,
} from "@/lib/google-calendar-oauth";
import { supabaseAdmin } from "@/lib/supabase";
import { mirrorClassesToTeacherCalendar } from "@/lib/teacher-calendar-sync";

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

    // Recién vinculado → espejar todas sus clases futuras agendadas al
    // calendar (tras responder, best-effort). Sin esto el calendar
    // arranca vacío hasta la próxima clase nueva.
    const teacherId = verified.teacherId;
    after(async () => {
      try {
        const sb = supabaseAdmin();
        const { data } = await sb
          .from("classes")
          .select("id")
          .eq("teacher_id", teacherId)
          .eq("status", "scheduled")
          .gte("scheduled_at", new Date().toISOString())
          .is("teacher_gcal_event_id", null)
          .is("deleted_at", null)
          .limit(200);
        const ids = ((data ?? []) as Array<{ id: string }>).map(r => r.id);
        if (ids.length > 0) await mirrorClassesToTeacherCalendar(ids);
      } catch (e) {
        console.error("[gcal-oauth] initial mirror after connect failed:", e);
      }
    });

    return NextResponse.redirect(`${platformUrl}/profesor?google_calendar=connected`);
  } catch (e) {
    console.error("[gcal-oauth] callback token exchange failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(
      `${platformUrl}/profesor?google_calendar=error&reason=token_exchange_failed`,
    );
  }
}
