import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendSesionRescheduleLinkMessage } from "@/lib/admin-actions";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

/**
 * POST /api/closer/leads/[id]/send-sesion-reschedule-link
 *
 * Cancela la sesión de plan actual del lead y envía por WhatsApp el
 * enlace a /sesion-plan/funnel para que elija nuevo horario.
 *
 * Accesible por: closer (propio lead), admin, superadmin.
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
  const actorName = (session.user.name ?? session.user.email ?? "closer") as string;

  const result = await sendSesionRescheduleLinkMessage(leadId, { actorName });
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }

  await registerContact({
    leadId,
    actor: await actorFromPanelUser({
      id: (session.user as { id: string }).id,
      email: session.user.email,
      role: role ?? "closer",
    }),
    actionType: "agendar_prueba",
    channel: "whatsapp",
    note: "Enlace de reagendar sesión de plan enviado",
  });

  return NextResponse.json({ ok: true });
}
