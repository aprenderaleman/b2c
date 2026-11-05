import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";

/**
 * GET /api/cron/acuerdo-unlock — el día 5 de cada mes (vercel.json).
 *
 * Alumnos con acuerdo especial (students.acuerdo_cierre, migración 151) y
 * acceso vigente: libera UNLOCK_PER_MONTH clases más (clases_desbloqueadas),
 * acumulativas (las no usadas se quedan), con tope en el total contratado.
 * Caso Lydia (Gelfis 2026-11-05): bono de 20 clases a 2/mes. Estos alumnos
 * no tienen Stripe, y el desbloqueo mensual normal solo ocurre con la
 * factura de renovación (webhooks/stripe/_shared.ts).
 *
 * Idempotente por mes: deja una nota "[acuerdo-unlock YYYY-MM]" en
 * admin_notes y no repite si ya existe. `?dry=1` solo lista.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const UNLOCK_PER_MONTH = 2;

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorisedCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const sb = supabaseAdmin();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const monthKey = today.slice(0, 7);
  const marker = `[acuerdo-unlock ${monthKey}]`;

  const { data: rows, error } = await sb
    .from("students")
    .select("id, clases_totales, classes_adjustment, clases_desbloqueadas, classes_remaining, access_until, users!inner(full_name, active)")
    .eq("acuerdo_cierre", true)
    .eq("users.active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const details: Array<Record<string, unknown>> = [];
  for (const raw of (rows ?? []) as Array<Record<string, unknown>>) {
    const uRaw = raw.users as Record<string, unknown> | Record<string, unknown>[];
    const u = Array.isArray(uRaw) ? uRaw[0] : uRaw;
    const studentId = raw.id as string;
    const name = (u.full_name as string | null) ?? "Estudiante";
    const accessUntil = raw.access_until as string | null;
    if (accessUntil && accessUntil < today) { details.push({ name, skipped: "acceso vencido" }); continue; }

    const cap = Number(raw.clases_totales ?? 0) + Number(raw.classes_adjustment ?? 0);
    const current = Number(raw.clases_desbloqueadas ?? 0);
    const next = Math.min(current + UNLOCK_PER_MONTH, cap);
    if (next <= current) { details.push({ name, skipped: "sin clases por liberar", current, cap }); continue; }

    const { data: done } = await sb
      .from("admin_notes").select("id")
      .eq("target_type", "student").eq("target_id", studentId)
      .ilike("content", `${marker}%`).limit(1);
    if (done && done.length > 0) { details.push({ name, skipped: "ya liberado este mes" }); continue; }

    if (dry) { details.push({ name, dry: true, from: current, to: next, cap }); continue; }

    const { error: ue } = await sb.from("students").update({ clases_desbloqueadas: next }).eq("id", studentId);
    if (ue) { details.push({ name, error: ue.message }); continue; }
    await sb.from("admin_notes").insert({
      target_type: "student", target_id: studentId, author_id: null,
      content: `${marker} +${next - current} clases liberadas del bono (desbloqueadas ${current} → ${next} de ${cap}; restantes ${raw.classes_remaining}).`,
    });

    // Aviso in-app al profe del grupo individual activo
    try {
      const { data: g } = await sb
        .from("student_group_members")
        .select("student_groups!inner(teacher_id, active, class_type)")
        .eq("student_id", studentId)
        .eq("student_groups.active", true)
        .limit(1);
      const sg = g?.[0] ? (Array.isArray(g[0].student_groups) ? g[0].student_groups[0] : g[0].student_groups) : null;
      const teacherId = (sg as { teacher_id?: string } | null)?.teacher_id;
      if (teacherId) {
        const { data: t } = await sb.from("teachers").select("user_id").eq("id", teacherId).maybeSingle();
        if (t) {
          await createNotification({
            user_id: (t as { user_id: string }).user_id, type: "generic",
            title: `${name} — ${next - current} clases más disponibles`,
            body: `Este mes se liberaron ${next - current} clases de su bono. Las no usadas se acumulan.`,
            link: "/profesor/estudiantes",
          }).catch(() => null);
        }
      }
    } catch { /* best-effort */ }

    details.push({ name, from: current, to: next, cap });
  }

  return NextResponse.json({ ok: true, month: monthKey, dry, processed: details.length, details });
}
