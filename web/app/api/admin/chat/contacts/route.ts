import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/chat/contacts
 * Listas de contactos para /admin/chats: profes y estudiantes con nombre,
 * email, teléfono y contexto (alumnos activos para profes; estado, plan y
 * profe para alumnos). Solo admin.
 */
export const dynamic = "force-dynamic";

export type Contact = {
  userId:   string;
  name:     string;
  email:    string;
  phone:    string | null;
  active:   boolean;
  subtitle: string;
};

type UserBits = { id: string; full_name: string | null; email: string; phone: string | null; active: boolean };
const first = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseAdmin();

  const [{ data: teachers }, { data: students }, { data: members }] = await Promise.all([
    sb.from("teachers").select("id, active, user_id, users!inner(id, full_name, email, phone, active, role)").eq("users.role", "teacher"),
    sb.from("students").select("id, user_id, subscription_status, subscription_type, classes_per_month, current_level, goal, users!inner(id, full_name, email, phone, active)"),
    sb.from("student_group_members").select("student_id, student_groups!inner(active, teachers!inner(users!inner(full_name)))").eq("student_groups.active", true),
  ]);

  const teacherOf: Record<string, string> = {};
  for (const m of (members ?? []) as Array<{ student_id: string; student_groups: unknown }>) {
    const g = first(m.student_groups as { teachers: unknown } | { teachers: unknown }[]);
    const t = first(g?.teachers as { users: unknown } | { users: unknown }[]);
    const u = first(t?.users as { full_name: string | null } | { full_name: string | null }[]);
    if (u?.full_name && !teacherOf[m.student_id]) teacherOf[m.student_id] = u.full_name.split(" ")[0];
  }
  const studentsOf: Record<string, number> = {};
  for (const st of (students ?? []) as Array<{ id: string; subscription_status: string }>) {
    const t = teacherOf[st.id];
    if (t && st.subscription_status === "active") studentsOf[t] = (studentsOf[t] ?? 0) + 1;
  }

  const ritmoLabel: Record<number, string> = { 6: "Viajero", 8: "Estándar", 12: "Intensivo", 16: "VIP" };
  const ritmo = (cpm: number | null, type: string) =>
    type !== "monthly_subscription" ? "Pack" : (ritmoLabel[cpm ?? 0] ?? "Suscripción");
  const estado: Record<string, string> = { active: "activo", paused: "en pausa", cancelled: "baja", expired: "terminó" };

  const profes: Contact[] = ((teachers ?? []) as Array<{ id: string; active: boolean; user_id: string; users: unknown }>).map(t => {
    const u = first(t.users as UserBits | UserBits[])!;
    const n = studentsOf[(u.full_name ?? "").split(" ")[0]] ?? 0;
    return {
      userId: u.id, name: u.full_name ?? u.email, email: u.email, phone: u.phone,
      active: t.active && u.active,
      subtitle: t.active ? `Profe · ${n} alumno${n === 1 ? "" : "s"} activo${n === 1 ? "" : "s"}` : "Profe · inactivo",
    };
  });

  type StudentBits = { id: string; subscription_status: string; subscription_type: string; classes_per_month: number | null; current_level: string | null; goal: string | null; users: unknown };
  const alumnos: Contact[] = ((students ?? []) as StudentBits[]).map(s => {
    const u = first(s.users as UserBits | UserBits[])!;
    const meta = (s.goal ?? "").toUpperCase().replace("A1_A2", "A2");
    const bits = [
      estado[s.subscription_status] ?? s.subscription_status,
      s.current_level ? `${s.current_level} → ${meta}` : null,
      ritmo(s.classes_per_month, s.subscription_type),
      teacherOf[s.id] ? `con ${teacherOf[s.id]}` : "sin profe",
    ].filter(Boolean);
    return {
      userId: u.id, name: u.full_name ?? u.email, email: u.email, phone: u.phone,
      active: u.active && ["active", "paused"].includes(s.subscription_status),
      subtitle: bits.join(" · "),
    };
  });

  const byName = (a: Contact, b: Contact) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es");
  return NextResponse.json({ profes: profes.sort(byName), alumnos: alumnos.sort(byName) });
}
