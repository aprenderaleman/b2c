import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";
import { ensureFuturePlay } from "@/lib/semaforo";

/**
 * POST /api/teacher/leads/[leadId]/note — nota del profesor sobre un
 * lead (perfil único: todos ven las notas de todos). Se guarda como
 * lead_timeline type='teacher_note' con el nombre del profe como autor
 * — mismo formato que las notas del Trial Hub, así aparecen en la
 * ficha del closer y del admin, y migran al estudiante al convertir.
 */
const Body = z.object({
  content: z.string().trim().min(3).max(2000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  let owns;
  try { owns = await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Autor = profesor real de la clase, no el user de sesión. Si Gelfis
  // (admin) escribe en la ficha en nombre del profe, la nota debe salir
  // atribuida al profe. Buscamos el trial activo del lead y sacamos su
  // teacher.user_id → full_name. Si no hay clase, fallback al owns
  // (que puede ser el propio user de sesión).
  let authorName = owns.teacherName ?? "Profesor";
  const { data: trialCls } = await sb
    .from("classes")
    .select("teacher_id")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tid = (trialCls as { teacher_id: string | null } | null)?.teacher_id;
  if (tid) {
    const { data: tRow } = await sb
      .from("teachers")
      .select("users:user_id (full_name)")
      .eq("id", tid)
      .maybeSingle();
    const realName = (tRow as { users: { full_name: string | null } | null } | null)?.users?.full_name;
    if (realName) authorName = realName;
  }

  const { error } = await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "teacher_note",
    author: authorName,
    content: parsed.data.content,
  });

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  // La nota también es un contacto (misma lógica que el closer, cuyo
  // flujo de notas se espeja a lead_contacts): actualiza el "último
  // contacto" y puede apagar rojos del semáforo. Notas <5 chars quedan
  // solo como nota (registerContact las rechaza silenciosamente).
  if (parsed.data.content.length >= 5) {
    await registerContact({
      leadId,
      actor: await actorFromPanelUser(user),
      actionType: "nota_libre",
      channel: "otro",
      note: parsed.data.content,
    });
  }

  // Anti-limbo: si el lead queda sin próxima jugada, auto-tarea +3d.
  await ensureFuturePlay(leadId).catch(() => {});

  return NextResponse.json({ ok: true });
}
