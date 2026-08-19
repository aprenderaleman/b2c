import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";

/**
 * POST /api/teacher/students/[studentId]/impersonate
 *
 * "Ver como alumno": abre SCHULE con el profe logueado como el alumno
 * en modo SOLO LECTURA. Toda la magia (banner púrpura, bloqueo de
 * POSTs, sesión 2h, auditoría) vive del lado SCHULE — aquí solo:
 *   1. Validamos rol (teacher/admin/superadmin).
 *   2. Teachers: solo alumnos asignados (grupo activo suyo — la misma
 *      regla que puebla "Mis estudiantes"). Admins: bypass.
 *   3. Proxy a SCHULE /api/b2c/sso-link con readOnly + impersonatedBy.
 *   4. Devolvemos { redirectUrl } para window.open en el cliente.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHULE_API = (process.env.SCHULE_API_URL ?? "https://api-schule.aprender-aleman.de").replace(/\/$/, "");

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; email?: string | null; name?: string | null; role?: string };
  const role = user.role;
  if (!role || !["teacher", "admin", "superadmin"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) {
    return NextResponse.json({ error: "invalid_student_id" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // b) Alumno existe
  const { data: student } = await sb
    .from("students")
    .select("id, users!inner(email, full_name)")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }
  const su0 = (student as { users: unknown }).users;
  const su = (Array.isArray(su0) ? su0[0] : su0) as { email: string; full_name: string | null };

  // c) Teachers: el alumno debe estar en un grupo activo del profe
  //    (misma fuente de verdad que la página "Mis estudiantes").
  if (role === "teacher") {
    const teacher = await getTeacherByUserId(user.id);
    if (!teacher) {
      return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    }
    const { data: assigned } = await sb
      .from("student_group_members")
      .select("student_id, group:student_groups!inner(teacher_id, active)")
      .eq("student_id", studentId)
      .eq("group.teacher_id", teacher.id)
      .eq("group.active", true)
      .limit(1)
      .maybeSingle();
    if (!assigned) {
      return NextResponse.json({ error: "not_your_student" }, { status: 403 });
    }
  }

  // d) Proxy a SCHULE
  const secret = process.env.B2C_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "config", message: "Error de configuración. Contactá con el equipo técnico." },
      { status: 500 },
    );
  }

  // Nombre real del actor desde la DB (session.name puede venir stale).
  const { data: actorRow } = await sb
    .from("users")
    .select("email, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const actor = actorRow as { email: string; full_name: string | null } | null;

  let res: Response;
  try {
    res = await fetch(`${SCHULE_API}/api/b2c/sso-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email:     su.email,
        full_name: su.full_name ?? su.email,
        secret,
        impersonatedBy: {
          id:       user.id,
          email:    actor?.email ?? user.email ?? "",
          fullName: actor?.full_name ?? user.name ?? "Profesor",
        },
        readOnly: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("[impersonate] SCHULE unreachable:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "schule_down", message: "SCHULE no responde, intenta de nuevo." },
      { status: 502 },
    );
  }

  if (res.status === 403) {
    console.error("[impersonate] SCHULE 403 — B2C_SYNC_SECRET mismatch?");
    return NextResponse.json(
      { error: "config", message: "Error de configuración. Contactá con el equipo técnico." },
      { status: 500 },
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[impersonate] SCHULE error:", res.status, body.slice(0, 300));
    return NextResponse.json(
      { error: "schule_down", message: "SCHULE no responde, intenta de nuevo." },
      { status: 502 },
    );
  }

  const data = await res.json().catch(() => null) as { redirectUrl?: string } | null;
  if (!data?.redirectUrl) {
    return NextResponse.json(
      { error: "schule_bad_response", message: "SCHULE no responde, intenta de nuevo." },
      { status: 502 },
    );
  }

  return NextResponse.json({ redirectUrl: data.redirectUrl });
}
