import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createClass } from "@/lib/classes";
import { sendWhatsappText } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { wireChatsForClass } from "@/lib/chat";

/**
 * POST /api/admin/classes
 *
 * Creates a class (single or recurring). Notifies the teacher and every
 * student via WhatsApp after successful creation (best-effort).
 */

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
 * After creating N classes, send a WhatsApp to each student and the
 * teacher summarising what just got scheduled. Best-effort.
 */
async function notifyParticipantsOnCreation(
  createdClassIds: string[],
  studentIds:      string[],
  teacherId:       string,
): Promise<void> {
  if (createdClassIds.length === 0) return;
  const sb = supabaseAdmin();

  // Fetch the first class (parent) for the summary line, and the teacher
  // + students phone/name/language.
  const { data: firstClass } = await sb
    .from("classes")
    .select("scheduled_at, duration_minutes, title")
    .eq("id", createdClassIds[0])
    .maybeSingle();
  if (!firstClass) return;

  const scheduledAt = new Date((firstClass as { scheduled_at: string }).scheduled_at);
  const count = createdClassIds.length;

  // Teacher — WhatsApp + in-app notification
  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id, users!inner(phone, full_name, language_preference)")
    .eq("id", teacherId)
    .maybeSingle();

  const teacherUser = (teacher as { users: unknown } | null)?.users;
  const tu = (Array.isArray(teacherUser) ? teacherUser[0] : teacherUser) as
    | { phone: string | null; full_name: string | null; language_preference: "es" | "de" }
    | undefined;
  const teacherUserId = (teacher as { user_id: string } | null)?.user_id;
  if (tu?.phone) {
    const text = teacherMessage(tu.language_preference, scheduledAt, count, (firstClass as { title: string }).title);
    await sendWhatsappText(tu.phone, text);
  }
  if (teacherUserId) {
    await createNotification({
      user_id: teacherUserId,
      type:    "class_scheduled",
      title:   count === 1 ? "Nueva clase agendada" : `Nueva serie (${count} clases) agendada`,
      body:    `${(firstClass as { title: string }).title} — ${fmtDate(scheduledAt, tu?.language_preference ?? "es")}`,
      link:    `/profesor/clases/${createdClassIds[0]}`,
      class_id: createdClassIds[0],
    });
  }

  // Students — WhatsApp + in-app notification
  const { data: studentRows } = await sb
    .from("students")
    .select("id, user_id, users!inner(phone, full_name, language_preference)")
    .in("id", studentIds);

  for (const s of studentRows ?? []) {
    const u = (s as { users: unknown }).users;
    const uu = (Array.isArray(u) ? u[0] : u) as
      | { phone: string | null; full_name: string | null; language_preference: "es" | "de" }
      | undefined;
    const userId = (s as { user_id: string }).user_id;

    if (uu?.phone) {
      const text = studentMessage(uu.language_preference, scheduledAt, count, (firstClass as { title: string }).title);
      await sendWhatsappText(uu.phone, text);
    }
    if (userId) {
      const lang = uu?.language_preference ?? "es";
      await createNotification({
        user_id:  userId,
        type:     "class_scheduled",
        title:    lang === "de"
          ? (count === 1 ? "Neue Stunde agendiert" : `Neue Serie (${count} Stunden) agendiert`)
          : (count === 1 ? "Nueva clase agendada" : `Nueva serie (${count} clases) agendada`),
        body:     `${(firstClass as { title: string }).title} — ${fmtDate(scheduledAt, lang)}`,
        link:     `/estudiante/clases/${createdClassIds[0]}`,
        class_id: createdClassIds[0],
      });
    }
  }
}

function fmtDate(d: Date, lang: "es" | "de"): string {
  return d.toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function teacherMessage(
  lang: "es" | "de",
  first: Date,
  count: number,
  title: string,
): string {
  if (lang === "de") {
    if (count === 1) {
      return `Neue Stunde agendiert 📚

${title}
${fmtDate(first, "de")} (Berlin)

Du findest sie auch in deinem Bereich. Bis dann!`;
    }
    return `Neue Reihe agendiert 📚

${title}
Start: ${fmtDate(first, "de")} (Berlin)
${count} Termine insgesamt.

Alle Stunden stehen in deinem Bereich.`;
  }
  if (count === 1) {
    return `Nueva clase agendada 📚

${title}
${fmtDate(first, "es")} (Berlín)

También la tienes en tu panel. ¡Nos vemos!`;
  }
  return `Nueva serie agendada 📚

${title}
Inicio: ${fmtDate(first, "es")} (Berlín)
${count} clases en total.

Tienes todas en tu panel.`;
}

function studentMessage(
  lang: "es" | "de",
  first: Date,
  count: number,
  title: string,
): string {
  if (lang === "de") {
    if (count === 1) {
      return `Deine Stunde ist bereit! 🎉

${title}
${fmtDate(first, "de")} (Berlin)

Du bekommst eine Erinnerung, bevor es losgeht. Bis dann!`;
    }
    return `Deine wiederkehrenden Stunden sind bereit! 🎉

${title}
Erste Stunde: ${fmtDate(first, "de")} (Berlin)
${count} Stunden insgesamt.

Vor jeder Stunde bekommst du eine Erinnerung.`;
  }
  if (count === 1) {
    return `¡Tu clase está lista! 🎉

${title}
${fmtDate(first, "es")} (Berlín)

Te enviaremos un recordatorio antes de que empiece. ¡Nos vemos!`;
  }
  return `¡Tus clases recurrentes están listas! 🎉

${title}
Primera clase: ${fmtDate(first, "es")} (Berlín)
${count} clases en total.

Te enviaremos un recordatorio antes de cada clase.`;
}
