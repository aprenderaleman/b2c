"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { recordStudentConfirmation } from "@/lib/student-confirmation";

/**
 * Server action: el lead pulsa "Sí, voy a asistir". Idempotente — si ya
 * estaba confirmado, no toca nada (la fecha original de confirmación
 * manda). Gelfis 2026-11-14.
 */
export async function confirmAttendanceAction(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  if (!code || code.length < 4 || code.length > 32) return;

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, status, student_confirmed_at")
    .eq("short_code", code)
    .maybeSingle();
  const c = cls as {
    id: string; lead_id: string | null; status: string;
    student_confirmed_at: string | null;
  } | null;

  if (!c || !c.lead_id) return;
  if (c.status === "cancelled") return;

  if (!c.student_confirmed_at) {
    await recordStudentConfirmation({
      classId: c.id,
      leadId:  c.lead_id,
      source:  "student_web",
    });
  }

  revalidatePath(`/c/${code}/confirmar`);
  redirect(`/c/${code}/confirmar`);
}
