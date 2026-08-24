import { supabaseAdmin } from "./supabase";

export type ClassBalance = {
  total: number | null;
  desbloqueadas: number;
  consumidas: number;
  agendadas: number;
  disponibles: number;
  classesPerMonth: number | null;
};

export async function getClassBalance(studentId: string): Promise<ClassBalance> {
  const sb = supabaseAdmin();

  const { data: student } = await sb
    .from("students")
    .select("clases_totales, clases_desbloqueadas, classes_per_month, classes_remaining")
    .eq("id", studentId)
    .maybeSingle();
  const s = student as {
    clases_totales: number | null;
    clases_desbloqueadas: number;
    classes_per_month: number | null;
    classes_remaining: number | null;
  } | null;
  if (!s) return { total: null, desbloqueadas: 0, consumidas: 0, agendadas: 0, disponibles: 0, classesPerMonth: null };

  const { data: consumedRow } = await sb
    .from("classes")
    .select("billed_hours")
    .eq("status", "completed")
    .not("billed_hours", "is", null)
    .gt("billed_hours", 0)
    .in("id", (await sb
      .from("class_participants")
      .select("class_id")
      .eq("student_id", studentId)
    ).data?.map((r: { class_id: string }) => r.class_id) ?? []);

  const consumidas = (consumedRow ?? []).reduce(
    (sum: number, r: { billed_hours: number }) => sum + (r.billed_hours ?? 0), 0
  );

  const { count: agendadas } = await sb
    .from("class_participants")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .in("class_id", (await sb
      .from("classes")
      .select("id")
      .eq("status", "scheduled")
      .gte("scheduled_at", new Date().toISOString())
    ).data?.map((r: { id: string }) => r.id) ?? []);

  const desbloqueadas = s.clases_desbloqueadas ?? 0;
  const cpm = s.classes_per_month;

  let disponibles = desbloqueadas - consumidas - (agendadas ?? 0);

  // Monthly cap: subscription students can't book more than their plan per cycle
  if (cpm != null && cpm > 0) {
    disponibles = Math.min(disponibles, cpm);
  }
  // Pack cap: never exceed remaining classes in the total pack
  if (s.classes_remaining != null) {
    disponibles = Math.min(disponibles, s.classes_remaining);
  }

  return {
    total: s.clases_totales,
    desbloqueadas,
    consumidas,
    agendadas: agendadas ?? 0,
    disponibles: Math.max(disponibles, 0),
    classesPerMonth: cpm,
  };
}

export type BookCheck = {
  allowed: boolean;
  reason?: string;
  graceApplied?: boolean;
};

export async function canBookClass(
  studentId: string,
  count: number = 1,
  adminOverride: boolean = false,
): Promise<BookCheck> {
  if (adminOverride) return { allowed: true };

  const sb = supabaseAdmin();

  const { data: student } = await sb
    .from("students")
    .select("oferta_id, clases_totales, stripe_subscription_status, classes_per_month, classes_remaining")
    .eq("id", studentId)
    .maybeSingle();
  const s = student as {
    oferta_id: string | null;
    clases_totales: number | null;
    stripe_subscription_status: string | null;
    classes_per_month: number | null;
    classes_remaining: number | null;
  } | null;

  if (!s?.oferta_id && s?.clases_totales == null) return { allowed: true };

  const balance = await getClassBalance(studentId);
  if (balance.disponibles >= count) return { allowed: true };

  // Grace: if subscription active and next charge < 5 days, allow 1 extra class
  if (s.stripe_subscription_status === "active" && count <= 1 && balance.disponibles >= 0) {
    return { allowed: true, graceApplied: true };
  }

  const monthlyNote = s.classes_per_month
    ? ` Tu plan incluye ${s.classes_per_month} clases al mes.`
    : "";

  return {
    allowed: false,
    reason: `No tienes clases disponibles (${balance.disponibles} disponibles, necesitas ${count}).${monthlyNote} Contacta a tu academia para más información.`,
  };
}
