import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markBonoConversacion } from "@/lib/bono-conversacion";

/**
 * POST /api/admin/students/[id]/bono-conversacion
 *
 * Marca la clase de conversación del bono 48h como dada/agendada.
 * Se usa desde la sección "Bonos de conversación pendientes" del
 * dashboard /admin. Con { undo: true } (JSON) revierte la marca.
 * El profe tiene su propio endpoint (/api/teacher/students/...).
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

  const result = await markBonoConversacion(id, undo);
  if (!result.ok) {
    const status = result.error === "student_not_found" ? 404 : result.error === "no_bono" ? 400 : 500;
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }

  // Form post desde el dashboard → volver a /admin. Fetch JSON → ok.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(new URL("/admin", req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, used: result.used, already: result.already });
}
