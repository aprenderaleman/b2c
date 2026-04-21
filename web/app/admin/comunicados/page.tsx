import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { ComunicadosForm } from "./ComunicadosForm";
import { HistoryPanel } from "./HistoryPanel";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Comunicados · Admin" };

/**
 * /admin/comunicados — one page to compose and fire a mass message
 * (email + whatsapp) to any slice of the academy. Supersedes the
 * earlier one-off /admin/broadcast teacher announcement flow.
 */
export default async function ComunicadosPage() {
  await requireRole(["admin", "superadmin"]);

  // Groups are the only bit of data we load up-front — everything else
  // comes through /preview on demand so filter changes stay snappy.
  const sb = supabaseAdmin();
  const { data: groupsRaw } = await sb
    .from("student_groups")
    .select("id, name, level")
    .order("name");

  const groups = (groupsRaw ?? []).map(g => ({
    id:    g.id as string,
    name:  (g.name as string) ?? "",
    level: (g.level as string) ?? "",
  }));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Comunicados
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Envía un mensaje a estudiantes, profesores o una lista personalizada por email y WhatsApp.
          Redacta, previsualiza, confirma.
        </p>
      </header>

      <ComunicadosForm groups={groups} />
      <HistoryPanel />
    </main>
  );
}
