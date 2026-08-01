import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { processActionResult } from "@/lib/closer-action-flow";

const Body = z.object({
  resultado: z.enum(["contactado", "no_contesto", "buzon", "no_interesado", "reagendado", "venta"]),
  notas: z.string().max(1000).optional(),
  objectionChip: z.enum(["precio", "pensarlo", "pareja", "tiempo", "otra"]).optional(),
  motivoNoInteresado: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = session.user.id;
  const { id: taskId } = await params;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: task } = await sb
    .from("tareas_closer")
    .select("lead_id, closer_id")
    .eq("id", taskId)
    .single();

  if (!task) {
    return NextResponse.json({ error: "task_not_found" }, { status: 404 });
  }
  if ((task as { closer_id: string }).closer_id !== closerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await processActionResult({
      taskId,
      closerId,
      leadId: (task as { lead_id: string }).lead_id,
      resultado: parsed.data.resultado,
      objectionChip: parsed.data.objectionChip ?? null,
      motivoNoInteresado: parsed.data.motivoNoInteresado ?? null,
      nota: parsed.data.notas ?? null,
    });
  } catch (err) {
    console.error("[closer/tasks/complete] processActionResult error:", err);
    return NextResponse.json({ error: "process_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
