import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import {
  addAvailabilityException,
  deleteAvailabilityException,
  listAvailabilityExceptions,
} from "@/lib/availability";

/**
 * Bloqueos puntuales de disponibilidad (migración 137).
 *
 *   GET    /api/teacher/availability/exceptions          → lista (futuro)
 *   POST   { date, start_time, end_time, reason? }       → crear
 *   DELETE ?id=<uuid>                                    → borrar
 *
 * Auth (mismo patrón que PUT /api/teacher/availability): un teacher opera
 * sobre sí mismo; admin/superadmin pasa ?teacherId=. Las páginas envían
 * SIEMPRE teacherId (lección impersonación 2026-09-23: para el teacher se
 * ignora y se resuelve por sesión).
 */

const PostBody = z.object({
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  end_time:   z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  reason:     z.string().trim().max(200).optional(),
  // bloqueo (default) = cerrar la franja esa fecha; apertura = abrirla
  // solo esa fecha (franja puntual, migración 138).
  kind:       z.enum(["bloqueo", "apertura"]).default("bloqueo"),
});

async function resolveTeacherId(req: Request): Promise<string | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  const override = new URL(req.url).searchParams.get("teacherId");

  if (role === "teacher") {
    const me = await getTeacherByUserId((session.user as { id: string }).id);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    return me.id;
  }
  if (role === "admin" || role === "superadmin") {
    if (!override) return NextResponse.json({ error: "teacherId_required" }, { status: 400 });
    return override;
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function GET(req: Request) {
  const teacherId = await resolveTeacherId(req);
  if (teacherId instanceof NextResponse) return teacherId;
  const exceptions = await listAvailabilityExceptions(teacherId);
  return NextResponse.json({ exceptions });
}

export async function POST(req: Request) {
  const teacherId = await resolveTeacherId(req);
  if (teacherId instanceof NextResponse) return teacherId;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const { date, start_time, end_time, reason, kind } = parsed.data;
  if (end_time <= start_time) {
    return NextResponse.json(
      { error: "validation_failed", message: "La hora fin debe ser mayor que la de inicio." },
      { status: 400 },
    );
  }
  const todayBerlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  if (date < todayBerlin) {
    return NextResponse.json(
      { error: "validation_failed", message: "La fecha ya pasó." },
      { status: 400 },
    );
  }

  try {
    const exception = await addAvailabilityException({
      teacherId,
      date,
      startTime: start_time + ":00",
      endTime:   end_time + ":00",
      reason:    reason ?? null,
      kind,
    });
    return NextResponse.json({ ok: true, exception });
  } catch (e) {
    return NextResponse.json(
      { error: "save_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const teacherId = await resolveTeacherId(req);
  if (teacherId instanceof NextResponse) return teacherId;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  try {
    await deleteAvailabilityException(teacherId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "delete_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
