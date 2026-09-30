import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/students/[id]/bono-conversacion
 *
 * Marca la clase de conversación del bono 48h como dada/agendada
 * (bono_conversacion_usada_at = now). Se usa desde la sección
 * "Bonos de conversación pendientes" del dashboard /admin.
 *
 * Con { undo: true } (JSON) revierte la marca.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let undo = false;
  try {
    const raw = await req.json();
    undo = Boolean((raw as { undo?: boolean })?.undo);
  } catch { /* form post sin body JSON — undo=false */ }

  const sb = supabaseAdmin();
  const { data: stu } = await sb
    .from("students")
    .select("id, bono_conversacion_at")
    .eq("id", id)
    .maybeSingle();
  if (!stu) return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  if (!(stu as { bono_conversacion_at: string | null }).bono_conversacion_at) {
    return NextResponse.json({ error: "no_bono" }, { status: 400 });
  }

  const { error } = await sb
    .from("students")
    .update({ bono_conversacion_usada_at: undo ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Form post desde el dashboard → volver a /admin. Fetch JSON → ok.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(new URL("/admin", req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, used: !undo });
}
