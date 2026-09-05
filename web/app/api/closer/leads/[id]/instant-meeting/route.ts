import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

function generateShortCode(): string {
  return randomBytes(6).toString("base64url").replace(/[_-]/g, "").slice(0, 8).toLowerCase();
}

/**
 * POST /api/closer/leads/[id]/instant-meeting
 *
 * Crea una sesión de videollamada instantánea para que el closer pueda
 * reunirse con el lead ahora mismo. Devuelve las URLs:
 *   - closerUrl: /aula/{classId}  (el closer abre directamente)
 *   - leadUrl:   /c/{shortCode}   (el closer envía manualmente al lead)
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (!["closer", "admin", "superadmin"].includes(role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: leadId } = await params;
  const closerId = (session.user as { id: string }).id;
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, closer_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (role === "closer" && lead.closer_id !== closerId) {
    return NextResponse.json({ error: "not_your_lead" }, { status: 403 });
  }

  const shortCode = generateShortCode();
  const now = new Date().toISOString();
  const firstName = ((lead.name ?? "Lead") as string).split(/\s+/)[0];

  const { data: cls, error } = await sb
    .from("classes")
    .insert({
      type: "individual",
      teacher_id: null,
      scheduled_at: now,
      duration_minutes: 25,
      title: `Reunión instantánea — ${firstName}`,
      status: "scheduled",
      is_trial: false,
      lead_id: leadId,
      sesion_closer_id: role === "closer" ? closerId : lead.closer_id,
      short_code: shortCode,
      notes_admin: "Reunión instantánea creada por el closer",
      notify_after_at: now,
    })
    .select("id, short_code")
    .single();

  if (error || !cls) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "system",
    content: `Reunión instantánea creada por ${session.user.name ?? "closer"}.`,
    metadata: {
      kind: "instant_meeting",
      class_id: (cls as { id: string }).id,
    },
  });

  const classId = (cls as { id: string }).id;
  const code = (cls as { short_code: string }).short_code;

  return NextResponse.json({
    ok: true,
    classId,
    closerUrl: `/aula/${classId}`,
    leadUrl: `/c/${code}`,
    leadUrlFull: `https://b2c.aprender-aleman.de/c/${code}`,
  });
}
