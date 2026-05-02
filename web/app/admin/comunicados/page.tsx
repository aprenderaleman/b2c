import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { ComunicadosForm, type EditingBroadcast } from "./ComunicadosForm";
import { HistoryPanel } from "./HistoryPanel";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Comunicados · Admin" };

/**
 * /admin/comunicados — one page to compose and fire a mass message
 * (email + whatsapp) to any slice of the academy. Supersedes the
 * earlier one-off /admin/broadcast teacher announcement flow.
 *
 * Edit flow: when `?edit=<id>` is present and the row is still queued,
 * we hydrate the composer with that row's payload and switch its
 * submit target to /update. Anything past 'queued' is rejected so we
 * never accidentally rewrite history.
 */
export default async function ComunicadosPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireRole(["admin", "superadmin"]);

  const sb = supabaseAdmin();
  const [{ data: groupsRaw }, edit] = await Promise.all([
    sb.from("student_groups").select("id, name, level").order("name"),
    loadEditing(sb, await searchParams),
  ]);

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
          Redacta, previsualiza, confirma — o programa para más tarde.
        </p>
      </header>

      <ComunicadosForm groups={groups} editing={edit} />
      <HistoryPanel />
    </main>
  );
}

async function loadEditing(
  sb: ReturnType<typeof supabaseAdmin>,
  params: { edit?: string },
): Promise<EditingBroadcast | null> {
  if (!params.edit) return null;
  const { data } = await sb
    .from("admin_broadcasts")
    .select("id, audience_filter, subject, message_markdown, channels, attachments, scheduled_at, status")
    .eq("id", params.edit)
    .maybeSingle();
  if (!data || data.status !== "queued") return null;
  return data as unknown as EditingBroadcast;
}
