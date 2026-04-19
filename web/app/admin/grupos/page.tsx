import { requireRole } from "@/lib/rbac";
import { listAllStudentGroups } from "@/lib/student-groups";
import { supabaseAdmin } from "@/lib/supabase";
import { GroupsList } from "./GroupsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grupos · Admin" };

export default async function AdminGroupsPage() {
  await requireRole(["admin", "superadmin"]);

  const [groups, teachers] = await Promise.all([
    listAllStudentGroups(),
    loadTeachers(),
  ]);

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Grupos</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cohorts de clases recurrentes. Cada grupo guarda su link de
          Google Docs (compartido con profes y alumnos) y el meet‑link
          legacy de Zoom (ignorado cuando LiveKit está activo).
        </p>
      </header>

      <GroupsList groups={groups} teachers={teachers} />
    </main>
  );
}

async function loadTeachers(): Promise<Array<{ id: string; full_name: string | null; email: string }>> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teachers")
    .select(`id, users!inner(full_name, email)`)
    .eq("active", true)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map(raw => {
    const r = raw as Record<string, unknown>;
    const u = r.users as Record<string, unknown> | Record<string, unknown>[];
    const uf = Array.isArray(u) ? u[0] : u;
    return {
      id: r.id as string,
      full_name: (uf?.full_name as string | null) ?? null,
      email: uf?.email as string,
    };
  });
}
