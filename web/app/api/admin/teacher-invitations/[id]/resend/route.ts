import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTeacherInvitationEmail } from "@/lib/email/send";
import {
  buildInvitationUrl,
  extendInvitationExpiry,
  markInvitationSent,
  type TeacherInvitation,
} from "@/lib/teacher-invitations";

/**
 * POST /api/admin/teacher-invitations/[id]/resend
 *
 * Reenvía el email de invitación. Si la invitación había expirado,
 * extiende la validez 14 días más (mismo código y mismo link).
 * No aplica a invitaciones ya completadas o revocadas.
 *
 * Auth: admin / superadmin.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_invitations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const inv = data as TeacherInvitation;
  if (inv.used_at) {
    return NextResponse.json({ ok: false, error: "already_completed" }, { status: 409 });
  }
  if (inv.revoked_at) {
    return NextResponse.json({ ok: false, error: "revoked" }, { status: 409 });
  }
  if (!inv.email) {
    return NextResponse.json({ ok: false, error: "no_email" }, { status: 400 });
  }

  // Extiende validez (14 días desde ahora) — cubre el caso "expirada,
  // reenviar" sin cambiar el código ni el link.
  const extended = await extendInvitationExpiry(id);

  const url = buildInvitationUrl(inv.code);
  const res = await sendTeacherInvitationEmail(inv.email, {
    name: inv.name,
    link: url,
  });
  if (res.ok) await markInvitationSent(id);

  return NextResponse.json({
    ok:          res.ok,
    email_sent:  res.ok,
    email_error: res.ok ? null : ("error" in res ? res.error : "unknown"),
    expires_at:  extended?.expires_at ?? inv.expires_at,
  });
}
