import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createClass } from "@/lib/classes";
import { sendClassLifecycleEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { wireChatsForClass } from "@/lib/chat";

/**
 * POST /api/admin/classes
 *
 * Creates a class (single or recurring). Notifies the teacher and every
 * student via EMAIL after successful creation (best-effort). WhatsApp
 * is reserved for trial-class leads — active accounts get email only.
 */

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const Body = z.object({
  type:              z.enum(["individual", "group"]),
  teacherId:         z.string().uuid(),
  studentIds:        z.array(z.string().uuid()).min(1).max(20),
  scheduledAt:       z.string().datetime(),                 // ISO 8601 with Z
  durationMinutes:   z.coerce.number().int().min(15).max(240),
  recurrencePattern: z.enum(["none", "weekly", "biweekly", "monthly"]).default("none"),
  recurrenceEndDate: z.string().date().nullable().default(null),
  title:             z.string().trim().min(2).max(200),
  topic:             z.string().trim().max(500).nullable().default(null),
  notesAdmin:        z.string().trim().max(2000).nullable().default(null),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.type === "individual" && body.studentIds.length !== 1) {
    return NextResponse.json(
      { error: "validation_failed", message: "Una clase individual requiere exactamente 1 estudiante." },
      { status: 400 },
    );
  }
  if (body.recurrencePattern !== "none" && !body.recurrenceEndDate) {
    return NextResponse.json(
      { error: "validation_failed", message: "Define una fecha fin para la recurrencia." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await createClass({
      type:              body.type,
      teacherId:         body.teacherId,
      studentIds:        body.studentIds,
      scheduledAt:       new Date(body.scheduledAt),
      durationMinutes:   body.durationMinutes,
      recurrencePattern: body.recurrencePattern,
      recurrenceEndDate: body.recurrenceEndDate ? new Date(body.recurrenceEndDate + "T23:59:59Z") : null,
      title:             body.title,
      topic:             body.topic,
      notesAdmin:        body.notesAdmin,
      createdByUserId:   (session.user as { id?: string }).id ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "create_failed", message: msg }, { status: 500 });
  }

  // Auto-create chats for this class (direct chat for individual, group
  // chat anchored to the parent class for series). Best-effort.
  wireChatsForClass({
    classId:    result.parentId,
    type:       body.type,
    teacherId:  body.teacherId,
    studentIds: body.studentIds,
    classTitle: body.title,
  }).catch(e => console.error("wireChatsForClass failed:", e));

  // Fire notifications — don't await each individually, we want to finish
  // the HTTP request fast. Batched in the background.
  notifyParticipantsOnCreation(
    result.ids,
    body.studentIds,
    body.teacherId,
  ).catch(e => console.error("notify failed:", e));

  return NextResponse.json({
    ok:        true,
    parentId:  result.parentId,
    instances: result.ids.length,
  });
}

/**
 * After creating N classes, send an EMAIL to each student and the
 * teacher summarising what just got scheduled, plus the in-app
 * notification. Best-effort — failures are logged and the request
 * still returns success.
 */
async function notifyParticipantsOnCreation(
  createdClassIds: string[],
  studentIds:      string[],
  teacherId:       string,
): Promise<void> {
  if (createdClassIds.length === 0) return;
  const sb = supabaseAdmin();

  const { data: firstClass } = await sb
    .from("classes")
    .select("scheduled_at, duration_minutes, title")
    .eq("id", createdClassIds[0])
    .maybeSingle();
  if (!firstClass) return;

  const cls = firstClass as { scheduled_at: string; duration_minutes: number; title: string };
  const scheduledAt = new Date(cls.scheduled_at);
  const count = createdClassIds.length;

  // Teacher — email + in-app notification
  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id, users!inner(email, full_name, language_preference)")
    .eq("id", teacherId)
    .maybeSingle();

  const teacherUser = (teacher as { users: unknown } | null)?.users;
  const tu = (Array.isArray(teacherUser) ? teacherUser[0] : teacherUser) as
    | { email: string; full_name: string | null; language_preference: "es" | "de" }
    | undefined;
  const teacherUserId = (teacher as { user_id: string } | null)?.user_id;
  if (tu?.email) {
    sendClassLifecycleEmail(tu.email, {
      audience:      "teacher",
      kind:          "created",
      recipientName: firstName(tu.full_name) || tu.email,
      classTitle:    cls.title,
      startDate:     fmtDate(scheduledAt, tu.language_preference) + (tu.language_preference === "de" ? " (Berlin)" : " (Berlín)"),
      durationMin:   cls.duration_minutes,
      count,
      classUrl:      `${PLATFORM_URL}/profesor/clases/${createdClassIds[0]}`,
      language:      tu.language_preference,
    }).catch(e => console.error("[admin/classes] teacher email failed:", e));
  }
  if (teacherUserId) {
    await createNotification({
      user_id: teacherUserId,
      type:    "class_scheduled",
      title:   count === 1 ? "Nueva clase agendada" : `Nueva serie (${count} clases) agendada`,
      body:    `${cls.title} — ${fmtDate(scheduledAt, tu?.language_preference ?? "es")}`,
      link:    `/profesor/clases/${createdClassIds[0]}`,
      class_id: createdClassIds[0],
    });
  }

  // Students — email + in-app notification
  const { data: studentRows } = await sb
    .from("students")
    .select("id, user_id, users!inner(email, full_name, language_preference)")
    .in("id", studentIds);

  for (const s of studentRows ?? []) {
    const u = (s as { users: unknown }).users;
    const uu = (Array.isArray(u) ? u[0] : u) as
      | { email: string; full_name: string | null; language_preference: "es" | "de" }
      | undefined;
    const userId = (s as { user_id: string }).user_id;

    if (uu?.email) {
      sendClassLifecycleEmail(uu.email, {
        audience:      "student",
        kind:          "created",
        recipientName: firstName(uu.full_name) || uu.email,
        classTitle:    cls.title,
        startDate:     fmtDate(scheduledAt, uu.language_preference) + (uu.language_preference === "de" ? " (Berlin)" : " (Berlín)"),
        durationMin:   cls.duration_minutes,
        count,
        classUrl:      `${PLATFORM_URL}/estudiante/clases/${createdClassIds[0]}`,
        language:      uu.language_preference,
      }).catch(e => console.error("[admin/classes] student email failed:", e));
    }
    if (userId) {
      const lang = uu?.language_preference ?? "es";
      await createNotification({
        user_id:  userId,
        type:     "class_scheduled",
        title:    lang === "de"
          ? (count === 1 ? "Neue Stunde agendiert" : `Neue Serie (${count} Stunden) agendiert`)
          : (count === 1 ? "Nueva clase agendada" : `Nueva serie (${count} clases) agendada`),
        body:     `${cls.title} — ${fmtDate(scheduledAt, lang)}`,
        link:     `/estudiante/clases/${createdClassIds[0]}`,
        class_id: createdClassIds[0],
      });
    }
  }
}

function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

function fmtDate(d: Date, lang: "es" | "de"): string {
  return d.toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

// Class-creation copy used to live as inline WhatsApp templates here
// (teacherMessage / studentMessage). Migrated to the shared
// class-lifecycle email template — see lib/email/templates/class-lifecycle.ts.
