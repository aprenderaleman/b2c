import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveCloserActor } from "@/lib/closer-auth";
import {
  registerContact,
  CONTACT_ACTION_TYPES,
  CONTACT_CHANNELS,
  type ContactActionType,
  type ContactChannel,
  type ContactActor,
} from "@/lib/contacts";

/**
 * POST /api/contacts/register — "Registrar contacto" universal (spec 2d).
 *
 * Un solo endpoint para los 3 roles de panel; el actor sale de la sesión,
 * nunca del body. Ownership:
 *   - closer  → lead.closer_id = él (o impersonación admin "ver como closer")
 *   - teacher → tiene una clase (trial) con el lead
 *   - admin   → cualquier lead
 *
 * Body: { leadId, actionType, channel, note?, occurredAt?, direction? }
 * Validaciones (en lib/contacts): nota_libre >= 5 chars, occurredAt máx
 * 48h atrás y nunca futuro. Los registros son inmutables.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;
  const userName = (session.user.name ?? session.user.email ?? "") as string;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const actionType = body.actionType as ContactActionType;
  const channel = body.channel as ContactChannel;
  const note = typeof body.note === "string" ? body.note : null;
  const occurredAt = typeof body.occurredAt === "string" ? body.occurredAt : null;
  const direction = body.direction === "entrante" ? "entrante" as const : "saliente" as const;

  if (!leadId) return NextResponse.json({ error: "missing_lead" }, { status: 400 });
  if (!CONTACT_ACTION_TYPES.includes(actionType)) {
    return NextResponse.json({ error: "invalid_action_type" }, { status: 400 });
  }
  if (!CONTACT_CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // ── Resolver actor + ownership según rol ──
  let actor: ContactActor | null = null;

  if (role === "admin" || role === "superadmin") {
    // Admin puede registrar sobre cualquier lead — pero si está en modo
    // "ver como closer", registra como ese closer (mismo criterio que el
    // resto del módulo closer).
    const imp = await resolveCloserActor();
    actor = imp && imp.id !== userId
      ? { type: "closer", id: imp.id, name: imp.name }
      : { type: "admin", id: userId, name: userName };
  } else if (role === "closer") {
    const closer = await resolveCloserActor();
    if (!closer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { data: lead } = await sb
      .from("leads").select("closer_id").eq("id", leadId).maybeSingle();
    if (!lead || (lead as { closer_id: string | null }).closer_id !== closer.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    actor = { type: "closer", id: closer.id, name: closer.name };
  } else if (role === "teacher") {
    const { data: teacherRow } = await sb
      .from("teachers").select("id").eq("user_id", userId).maybeSingle();
    if (!teacherRow) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: cls } = await sb
      .from("classes")
      .select("id")
      .eq("lead_id", leadId)
      .eq("teacher_id", (teacherRow as { id: string }).id)
      .is("deleted_at", null)
      .limit(1);
    if (!cls || cls.length === 0) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    actor = { type: "profesor", id: userId, name: userName };
  } else {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const res = await registerContact({
    leadId, actor, direction, actionType, channel, note, occurredAt,
  });

  if (!res.ok) {
    const status = res.error === "db_error" ? 500 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }

  // Anti-limbo: registrar un contacto también es "guardar una acción" —
  // si el lead queda sin próxima jugada, el sistema crea la auto-tarea.
  const { ensureFuturePlay } = await import("@/lib/semaforo");
  await ensureFuturePlay(leadId).catch(() => {});

  return NextResponse.json({ ok: true, id: res.id });
}
