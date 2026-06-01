import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/leads/[id]/cold-call
 *
 * Toggle del check de llamada fría en /admin/leads/[id].
 *
 *   Body: { done: boolean, note?: string }
 *
 * Marca o desmarca el timestamp `cold_call_done_at` del lead. En
 * ambos casos registra el cambio en `lead_timeline` para historial.
 * Solo superadmin/admin pueden tocarlo.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "superadmin" && role !== "admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  let body: { done?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const done = body.done === true;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  const sb = supabaseAdmin();
  const newValue = done ? new Date().toISOString() : null;

  const { error: updErr } = await sb
    .from("leads")
    .update({ cold_call_done_at: newValue })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Timeline entry para historial. Useful cuando reviso el lead más
  // tarde y quiero ver cuándo fue la última llamada fría.
  const author = session.user?.name ?? session.user?.email ?? "admin";
  const content = done
    ? `📞 Llamada fría marcada como hecha${note ? ` — ${note}` : ""}`
    : `📞 Llamada fría DESMARCADA (vuelve a pendiente)${note ? ` — ${note}` : ""}`;
  await sb.from("lead_timeline").insert({
    lead_id:  id,
    type:     "gelfis_note",
    author,
    content,
    metadata: { kind: "cold_call_toggle", done, note: note || null },
  });

  return NextResponse.json({ ok: true, cold_call_done_at: newValue });
}
