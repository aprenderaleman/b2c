import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { listTrialClasses, partitionByTime } from "@/lib/trial-classes";
import { supabaseAdmin } from "@/lib/supabase";
import { TrialHubShell } from "./TrialHubShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases de prueba · Profesor" };

export default async function TeacherTrialClassesPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Clases de prueba
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor asociado.
        </p>
      </main>
    );
  }

  const rows = await listTrialClasses(teacher.id);
  const { upcoming, past } = partitionByTime(rows);

  // Resolve converted_to_user_id → students.id for scheduling
  const convertedUserIds = [
    ...new Set(
      rows
        .map((r) => r.leadConvertedToUserId)
        .filter((x): x is string => !!x),
    ),
  ];
  const studentMap: Record<string, string> = {};
  if (convertedUserIds.length > 0) {
    const sb = supabaseAdmin();
    const { data: students } = await sb
      .from("students")
      .select("id, user_id")
      .in("user_id", convertedUserIds);
    for (const s of students ?? []) {
      studentMap[s.user_id] = s.id;
    }
  }

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Mis clases de prueba
        </h1>
      </header>

      <TrialHubShell
        upcoming={upcoming}
        past={past}
        studentMap={studentMap}
      />
    </main>
  );
}
