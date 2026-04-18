import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { replaceTeacherAvailability, type AvailabilityDraft } from "@/lib/availability";

/**
 * PUT /api/teacher/availability
 *
 * Replaces the caller teacher's availability set. Admins can also call
 * this on behalf of a teacher by passing ?teacherId=...
 */

const Body = z.object({
  blocks: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    start_time:  z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
    end_time:    z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
    available:   z.boolean().default(true),
  })).max(50),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  const overrideTeacherId = url.searchParams.get("teacherId");

  let teacherId: string | null = null;
  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    teacherId = me.id;
  } else if (role === "admin" || role === "superadmin") {
    teacherId = overrideTeacherId;
    if (!teacherId) return NextResponse.json({ error: "teacherId_required" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  // Validate that end_time > start_time on every block.
  for (const b of parsed.data.blocks) {
    if (b.end_time <= b.start_time) {
      return NextResponse.json(
        { error: "validation_failed", message: `Bloque inválido: ${b.start_time}–${b.end_time} (la hora fin debe ser mayor).` },
        { status: 400 },
      );
    }
  }

  const draft: AvailabilityDraft = parsed.data.blocks.map(b => ({
    day_of_week: b.day_of_week,
    start_time:  b.start_time + ":00",
    end_time:    b.end_time   + ":00",
    available:   b.available,
  }));

  try {
    await replaceTeacherAvailability(teacherId, draft);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "save_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
