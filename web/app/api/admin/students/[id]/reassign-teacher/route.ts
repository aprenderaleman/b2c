import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assignTeacherWithNotices, getAssignTeacherOptions, previewAssignTeacher } from "@/lib/assign-teacher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/students/[id]/reassign-teacher — botón "Asignar profe" de la
 * ficha del estudiante (Gelfis 2026-11-25). Solo admin / superadmin.
 *
 * GET  → profe actual, profe de la prueba y lista de profes activos.
 * POST → { newTeacherId, note?, includePhone?, notify?, dryRun? }
 *        dryRun: devuelve los mensajes exactos y la limpieza prevista, sin
 *        cambiar nada. Sin dryRun: asigna, limpia los avisos anteriores sin
 *        leer del alumno y envía por chat los avisos marcados en `notify`.
 */

const Body = z.object({
  newTeacherId: z.string().uuid(),
  note:         z.string().max(500).optional().nullable(),
  /** Compatibilidad con llamadas antiguas: se usa como nota si no hay `note`. */
  reason:       z.string().max(500).optional(),
  includePhone: z.boolean().optional(),
  dryRun:       z.boolean().optional(),
  notify: z.object({
    student:      z.boolean().optional(),
    newTeacher:   z.boolean().optional(),
    oldTeacher:   z.boolean().optional(),
    trialTeacher: z.boolean().optional(),
  }).optional(),
});

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  return { userId: (session.user as { id: string }).id } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  const { id } = await params;
  const options = await getAssignTeacherOptions(id);
  if (!options) return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...options });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  const { id: studentId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;
  const note = (b.note ?? b.reason ?? "").trim() || null;

  if (b.dryRun) {
    const p = await previewAssignTeacher({ studentId, newTeacherId: b.newTeacherId, note, includePhone: b.includePhone });
    if (!p.ok) return NextResponse.json({ ok: false, error: p.error }, { status: 400 });
    return NextResponse.json({ ok: true, ...p.preview });
  }

  const result = await assignTeacherWithNotices({
    studentId, newTeacherId: b.newTeacherId, actorUserId: a.userId,
    note, includePhone: b.includePhone, notify: b.notify,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
