import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPackCompletedEmail } from "@/lib/email/send";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * POST /api/admin/pack-alerts/send
 *
 * Send pack-completed emails + in-app notifications to specific students.
 * Admin-only. Body: { studentIds: string[] }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { studentIds } = (await req.json()) as { studentIds: string[] };
  if (!studentIds?.length) return NextResponse.json({ error: "no_students" }, { status: 400 });

  const sb = supabaseAdmin();
  const WHATSAPP_URL = "https://wa.me/4917684930450";
  const results: Array<{ name: string; email: boolean; notification: boolean }> = [];

  for (const studentId of studentIds) {
    const { data: student } = await sb
      .from("students")
      .select("id, user_id, classes_purchased, users!inner(full_name, email)")
      .eq("id", studentId)
      .single();

    if (!student) {
      results.push({ name: studentId, email: false, notification: false });
      continue;
    }

    const u = (student as Record<string, unknown>).users as Record<string, unknown>;
    const fullName = (u.full_name as string) ?? "Estudiante";
    const email = u.email as string;
    const totalClasses = (student as Record<string, unknown>).classes_purchased as number;
    const userId = (student as Record<string, unknown>).user_id as string;

    // Send email
    const emailResult = await sendPackCompletedEmail(email, {
      name: fullName,
      totalClasses,
      whatsappUrl: WHATSAPP_URL,
    });

    // Create in-app notification
    let notifOk = false;
    try {
      await createNotification({
        user_id: userId,
        type: "generic",
        title: "Has completado tu plan — felicidades!",
        body: `Felicidades! Has completado tus ${totalClasses} clases. Cuéntanos cómo ha sido tu experiencia y comunícate con Gelfis Horn para los siguientes pasos.`,
        link: null,
      });
      notifOk = true;
    } catch { /* ignore */ }

    results.push({ name: fullName, email: emailResult.ok, notification: notifOk });
  }

  return NextResponse.json({ ok: true, results });
}
