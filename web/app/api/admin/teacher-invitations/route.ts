import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createInvitation,
  listActiveInvitations,
  buildInvitationUrl,
} from "@/lib/teacher-invitations";

/**
 * GET /api/admin/teacher-invitations
 *   Lista las invitaciones activas (no usadas, no revocadas, no expiradas).
 *
 * POST /api/admin/teacher-invitations
 *   Body: { email?: string, notes?: string }
 *   Crea una invitación nueva y devuelve { code, url, expiresAt }.
 *
 * Auth: admin / superadmin.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const CreateBody = z.object({
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  notes: z.string().trim().max(200).optional().or(z.literal("")),
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
  const invitations = await listActiveInvitations();
  return NextResponse.json({
    ok: true,
    invitations: invitations.map(inv => ({
      id:         inv.id,
      code:       inv.code,
      email:      inv.email,
      notes:      inv.notes,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      url:        buildInvitationUrl(inv.code),
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

  const { invitation, url } = await createInvitation({
    createdBy: a.userId,
    email:     parsed.data.email || null,
    notes:     parsed.data.notes || null,
  });

  return NextResponse.json({
    ok:         true,
    code:       invitation.code,
    url,
    expires_at: invitation.expires_at,
  });
}
