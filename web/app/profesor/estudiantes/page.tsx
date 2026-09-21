import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId, goalLevelEs, ritmoLabelEs } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { ViewAsStudentButton } from "@/components/teacher/ViewAsStudentButton";
import { getClassBalance } from "@/lib/class-balance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis estudiantes · Profesor" };

type StudentCore = {
  current_level: string;
  goal: string | null;
  subscription_type: string;
  subscription_status: string;
  classes_per_month: number | null;
  monthly_price_cents: number | null;
  classes_remaining: number | null;
  clases_totales: number | null;
  oferta_id: string | null;
  users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
};

type Item = {
  id: string; name: string | null; email: string;
  level: string; goal: string | null;
  subscription_type: string; subscription_status: string;
  classes_per_month: number | null; monthly_price_cents: number | null;
  total: number | null; remaining: number | null;
  hasOferta: boolean; disponibles: number | null;
};

export default async function TeacherStudentsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const me = await getTeacherByUserId(session.user.id);
  if (!me) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis estudiantes</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor.
        </p>
      </main>
    );
  }

  const sb = supabaseAdmin();
  // Fuente de verdad: alumnos en un grupo activo asignado a este profesor.
  const { data: viaGroups } = await sb.from("student_group_members")
    .select(`
      student_id,
      students!inner(
        current_level, goal, subscription_type, subscription_status,
        classes_per_month, monthly_price_cents, classes_remaining, clases_totales, oferta_id,
        users!inner(full_name, email, active)
      ),
      group:student_groups!inner(teacher_id, active)
    `)
    .eq("group.teacher_id", me.id)
    .eq("group.active", true)
    .eq("students.users.active", true);

  const seen = new Map<string, Item>();
  for (const r of (viaGroups ?? []) as Array<{ student_id: string; students: StudentCore | StudentCore[] }>) {
    if (seen.has(r.student_id)) continue;
    const s = Array.isArray(r.students) ? r.students[0] : r.students;
    if (!s) continue;
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    seen.set(r.student_id, {
      id: r.student_id,
      name: u?.full_name ?? null,
      email: u?.email ?? "",
      level: s.current_level,
      goal: s.goal,
      subscription_type: s.subscription_type,
      subscription_status: s.subscription_status,
      classes_per_month: s.classes_per_month,
      monthly_price_cents: s.monthly_price_cents,
      total: s.clases_totales,
      remaining: s.classes_remaining,
      hasOferta: !!s.oferta_id || s.clases_totales != null,
      disponibles: null,
    });
  }

  // "Agendables ahora" = balance mensual (desbloqueadas − consumidas − agendadas),
  // distinto del total restante del pack. Se muestran ambos.
  await Promise.all(
    Array.from(seen.values())
      .filter(s => s.hasOferta)
      .map(async (s) => {
        const b = await getClassBalance(s.id).catch(() => null);
        if (b) s.disponibles = b.disponibles;
      }),
  );

  const list = Array.from(seen.values()).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis estudiantes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {list.length} estudiante{list.length === 1 ? "" : "s"} a los que das clase. Los datos se actualizan solos al completar cada clase.
        </p>
      </header>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {list.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            Aún no te han asignado estudiantes. Aparecerán aquí cuando el admin agende una clase contigo.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
              <tr>
                <Th>Nombre</Th>
                <Th>Nivel → Meta</Th>
                <Th>Ritmo</Th>
                <Th>Progreso del plan</Th>
                <Th>Clases restantes</Th>
                <Th>Agendables este mes</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {list.map(s => {
                const total = s.total ?? 0;
                const remaining = s.remaining ?? 0;
                const done = Math.max(0, total - remaining);
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                return (
                  <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <Td>
                      <Link href={`/profesor/estudiantes/${s.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                        {s.name ?? s.email}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-medium">{s.level}</span>
                      <span className="text-slate-400 mx-1">→</span>
                      <span className="font-medium">{goalLevelEs(s.goal)}</span>
                    </Td>
                    <Td>{ritmoLabelEs(s)}</Td>
                    <Td>
                      {total > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="tabular-nums text-xs text-slate-700 dark:text-slate-200">
                            <strong>{done}</strong> dadas de <strong>{total}</strong> contratadas
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="tabular-nums text-[11px] text-slate-500 dark:text-slate-400">{pct}% del plan</span>
                          </div>
                        </div>
                      ) : <span className="text-xs text-slate-400">sin contrato</span>}
                    </Td>
                    <Td>
                      <span className={`tabular-nums font-semibold ${remaining <= 4 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {s.remaining ?? "—"}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400"> por dar</span>
                    </Td>
                    <Td>
                      {s.hasOferta && s.disponibles != null ? (
                        <>
                          <span className={`text-sm font-semibold tabular-nums ${
                            s.disponibles <= 1 ? "text-red-600 dark:text-red-400"
                            : s.disponibles <= 3 ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                          }`}>
                            {s.disponibles}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400"> puedes agendar</span>
                        </>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </Td>
                    <Td><ViewAsStudentButton studentId={s.id} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 whitespace-nowrap">{children}</td>;
}
