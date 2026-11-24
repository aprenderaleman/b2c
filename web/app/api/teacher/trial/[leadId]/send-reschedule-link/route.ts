import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { getTeacherRescheduleStatus, teacherRescheduleTrial } from "@/lib/teacher-reschedule";

/**
 * /api/teacher/trial/[leadId]/send-reschedule-link
 *
 * POST — botón "Reagendar" del profe (y del closer): cancela la clase de
 * prueba futura, pasa el lead a 'Reagendando' y le envía el enlace para
 * elegir nuevo horario.
 *
 * Desde 2026-11-24 el PROFE debe indicar el motivo en el cuerpo:
 *   { reason: "lead_no_confirmo" }
 *   { reason: "profe_no_puede", note: "..." }
 * Reglas, validaciones y avisos: lib/teacher-reschedule.ts. Closer/admin
 * pueden seguir llamando sin motivo (copy genérico de siempre).
 *
 * GET — estado para la ventana del profe: si hay clase futura, si el lead
 * confirmó, si la nota de voz está marcada y si puede usar "Lead no confirmó".
 */

async function authorise(leadId: string) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch { return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const; }
  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const; }
  return { user } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const a = await authorise(leadId);
  if ("error" in a) return a.error;
  return NextResponse.json(await getTeacherRescheduleStatus(leadId));
}

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const a = await authorise(leadId);
  if ("error" in a) return a.error;

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; note?: unknown };
  const r = await teacherRescheduleTrial({ leadId, user: a.user, reason: body.reason, note: body.note });
  return NextResponse.json(r.body, { status: r.status });
}
