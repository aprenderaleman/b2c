import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendClassScheduleSummaryEmail } from "@/lib/email/send";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * POST /api/admin/notify-schedule
 *
 * Send a class-schedule-summary email to a student for a given group.
 * Admin or CRON_SECRET auth.
 * Body: { studentId, groupId }
 */
export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (bearer && cronSecret && bearer === cronSecret) {
    // trusted
  } else {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const role = (session.user as { role?: string }).role;
    if (role !== "admin" && role !== "superadmin")
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { studentId, groupId } = (await req.json()) as { studentId: string; groupId: string };
  const sb = supabaseAdmin();
  const PLATFORM_URL = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";

  // Get student info
  const { data: student } = await sb
    .from("students")
    .select("id, user_id, users!inner(full_name, email)")
    .eq("id", studentId)
    .single();
  if (!student) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  const u = (student as Record<string, unknown>).users as Record<string, unknown>;
  const fullName = (u.full_name as string) ?? "Estudiante";
  const email = u.email as string;
  const userId = (student as Record<string, unknown>).user_id as string;

  // Get group info
  const { data: group } = await sb
    .from("student_groups")
    .select("name")
    .eq("id", groupId)
    .single();
  const groupName = (group as Record<string, unknown>)?.name as string ?? "Deutsch";

  // Get scheduled classes for this group
  const { data: classes } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes")
    .eq("group_id", groupId)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });

  if (!classes?.length) return NextResponse.json({ error: "no_classes" }, { status: 400 });

  // Format first class date in Berlin TZ
  const firstDate = new Date(classes[0].scheduled_at as string);
  const firstFormatted = firstDate.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Berlin",
  }) + " a las " + firstDate.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  // Build human-readable slots
  const slotsHuman = [
    `Martes y jueves a las 10:00 (Berlín) · 50 min`,
    `${classes.length} clases · del ${firstDate.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Berlin" })} al ${new Date(classes[classes.length - 1].scheduled_at as string).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" })}`,
  ];

  const firstClassId = classes[0].id as string;

  // Send email
  const emailResult = await sendClassScheduleSummaryEmail(email, {
    recipientName: fullName.split(" ")[0],
    classTitle: groupName,
    totalClasses: classes.length,
    firstClassAt: firstFormatted,
    slotsHuman,
    classUrl: `${PLATFORM_URL}/estudiante/clases/${firstClassId}`,
    language: "es",
  });

  // In-app notification
  let notifOk = false;
  try {
    await createNotification({
      user_id: userId,
      type: "class_scheduled",
      title: `${classes.length} clases agendadas`,
      body: `Tienes ${classes.length} clases agendadas con Gelfis Horn. La primera es el ${firstFormatted}.`,
      link: `/estudiante/clases`,
      class_id: firstClassId,
    });
    notifOk = true;
  } catch { /* ignore */ }

  return NextResponse.json({
    ok: true,
    email: emailResult.ok,
    notification: notifOk,
    totalClasses: classes.length,
    firstClass: firstFormatted,
  });
}
