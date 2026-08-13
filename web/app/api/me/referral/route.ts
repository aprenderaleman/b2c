import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getImpersonation } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrCreateReferralCode, referralStats, buildReferralLink } from "@/lib/referrals";
import { getAttendanceStreakForStudent } from "@/lib/attendance-streak";

/**
 * GET  /api/me/referral      → código (lazy) + link + contadores + victory
 * POST /api/me/referral      → { action: "dismiss_popup" } marca el
 *                              throttle mensual del popup de victorias
 *
 * Victory (popup de momentos de victoria): se ofrece SOLO si
 *   - ha pasado ≥1 mes desde last_referral_popup_at (o nunca), Y
 *   - hay un logro reciente: certificado emitido en los últimos 7 días,
 *     racha de asistencia ≥5, o total de clases asistidas múltiplo de 10.
 * El cliente decide mostrarlo; al cerrarse llama al POST dismiss.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveStudent(): Promise<{ studentId: string } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const imp = await getImpersonation();
  const userId = imp?.target_id ?? (session.user as { id: string }).id;
  const sb = supabaseAdmin();
  const { data } = await sb.from("students").select("id").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  return { studentId: (data as { id: string }).id };
}

export async function GET() {
  const me = await resolveStudent();
  if (!me) return NextResponse.json({ error: "no_student" }, { status: 403 });

  const code = await getOrCreateReferralCode(me.studentId);
  const stats = await referralStats(me.studentId);

  // ── Victory check ─────────────────────────────────────────────────
  const sb = supabaseAdmin();
  const { data: st } = await sb
    .from("students")
    .select("last_referral_popup_at")
    .eq("id", me.studentId)
    .maybeSingle();
  const lastPopup = (st as { last_referral_popup_at: string | null } | null)?.last_referral_popup_at;
  const monthOk = !lastPopup || (Date.now() - new Date(lastPopup).getTime()) > 30 * 24 * 3600_000;

  let victory: string | null = null;
  if (monthOk) {
    // Certificado reciente (7 días)
    const { data: cert } = await sb
      .from("certificates")
      .select("title, issued_at")
      .eq("student_id", me.studentId)
      .gte("issued_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cert) {
      victory = `¡Certificado conseguido: ${(cert as { title: string }).title}!`;
    } else {
      const streak = await getAttendanceStreakForStudent(me.studentId).catch(() => null);
      if (streak && streak.current >= 5) {
        victory = `¡Racha de ${streak.current} clases seguidas!`;
      } else {
        const { count } = await sb
          .from("class_participants")
          .select("id, classes!inner(status)", { count: "exact", head: true })
          .eq("student_id", me.studentId)
          .eq("attended", true)
          .eq("classes.status", "completed");
        const attended = count ?? 0;
        if (attended > 0 && attended % 10 === 0) {
          victory = `¡${attended} clases completadas!`;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    code,
    link: code ? buildReferralLink(code) : null,
    invited_count:   stats.invited_count,
    converted_count: stats.converted_count,
    classes_earned:  stats.classes_earned,
    victory,
  }, { headers: { "Cache-Control": "private, max-age=30" } });
}

export async function POST(req: NextRequest) {
  const me = await resolveStudent();
  if (!me) return NextResponse.json({ error: "no_student" }, { status: 403 });

  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }

  if (body.action === "dismiss_popup") {
    const sb = supabaseAdmin();
    await sb.from("students")
      .update({ last_referral_popup_at: new Date().toISOString() })
      .eq("id", me.studentId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
