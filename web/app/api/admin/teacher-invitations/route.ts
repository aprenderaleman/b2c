import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendTeacherInvitationEmail } from "@/lib/email/send";
import {
  createInvitation,
  listInvitations,
  buildInvitationUrl,
  invitationStatus,
  markInvitationSent,
} from "@/lib/teacher-invitations";

/**
 * GET /api/admin/teacher-invitations
 *   Lista invitaciones recientes (todas — estado derivado:
 *   pendiente / completada / expirada / revocada).
 *
 * POST /api/admin/teacher-invitations
 *   Body: { email*, name?, rate_individual*, rango?, accepts_trials?, notes? }
 *   Crea la invitación con las condiciones acordadas y envía el email
 *   al candidato. Devuelve la URL por si el admin prefiere copiarla.
 *
 * Auth: admin / superadmin.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const CreateBody = z.object({
  email:           z.string().trim().toLowerCase().email(),
  name:            z.string().trim().max(120).optional().or(z.literal("")),
  rate_individual: z.coerce.number().positive().max(500),
  rango:           z.enum(["starter", "pro", "elite", "master"]).default("starter"),
  accepts_trials:  z.boolean().default(false),
  notes:           z.string().trim().max(200).optional().or(z.literal("")),
  /** false = solo generar link, no enviar email. Default true. */
  send_email:      z.boolean().default(true),
});

async function requireAdmin() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return { ok: false as const };
  }
  return { ok: true as const, userId: (session.user as { id: string }).id };
}

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const invitations = await listInvitations();
  return NextResponse.json({
    ok: true,
    invitations: invitations.map(inv => ({
      id:              inv.id,
      code:            inv.code,
      email:           inv.email,
      name:            inv.name,
      notes:           inv.notes,
      rate_individual: inv.rate_individual_eur,
      rango:           inv.rango,
      accepts_trials:  inv.accepts_trials,
      created_at:      inv.created_at,
      expires_at:      inv.expires_at,
      last_sent_at:    inv.last_sent_at,
      status:          invitationStatus(inv),
      url:             buildInvitationUrl(inv.code),
    })),
  });
}

export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const { invitation, url } = await createInvitation({
    createdBy:      a.userId,
    email:          b.email,
    name:           b.name || null,
    notes:          b.notes || null,
    rateIndividual: b.rate_individual,
    rango:          b.rango,
    acceptsTrials:  b.accepts_trials,
  });

  let emailSent = false;
  let emailError: string | null = null;
  if (b.send_email) {
    const res = await sendTeacherInvitationEmail(b.email, {
      name: b.name || null,
      link: url,
    });
    emailSent = res.ok;
    if (res.ok) {
      await markInvitationSent(invitation.id);
    } else {
      emailError = "error" in res ? (res.error ?? "unknown") : "unknown";
    }
  }

  return NextResponse.json({
    ok:          true,
    code:        invitation.code,
    url,
    expires_at:  invitation.expires_at,
    email_sent:  emailSent,
    email_error: emailError,
  });
}
