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

      <aside className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/5 px-4 py-3 text-xs text-slate-700 dark:text-slate-200">
        <p className="font-semibold text-brand-700 dark:text-brand-300 mb-1">📚 Cómo se gestionan grupos y clases</p>
        <p>
          Crea aquí el grupo con <strong>"Nuevo grupo"</strong> — el wizard te
          deja definir miembros y agendar todas las clases (semanales en días
          específicos, fechas custom estilo Zoom, mensual, etc.) en un solo
          flujo. Para añadir o quitar miembros más adelante, usa{" "}
          <strong>Editar</strong> en cada card y los cambios se propagan a
          todas las clases futuras.
        </p>
        <p className="mt-1.5 text-slate-500 dark:text-slate-400">
          Si necesitas una clase suelta (recuperación, sustitución, lead que
          aún no es estudiante), ve a{" "}
          <a href="/admin/clases" className="underline underline-offset-2 hover:text-brand-700 dark:hover:text-brand-300">/admin/clases</a>.
        </p>
      </aside>

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
