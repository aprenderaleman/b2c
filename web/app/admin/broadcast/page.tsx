import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { renderTeacherPlatformAnnouncement } from "@/lib/email/templates/teacher-platform-announcement";
import { BroadcastTrigger } from "./BroadcastTrigger";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Broadcast · Admin" };

const PLATFORM_URL = "https://b2c.aprender-aleman.de/login";
const VIDEO_URL    = "https://www.youtube.com/watch?v=6-Nek-2EPp8";
const CUTOVER_DATE = "lunes 27 de abril";

/**
 * One-off admin tool: preview + send the "new platform is live"
 * announcement to every active teacher. Built for the Zoom→B2C cutover
 * on 2026-04-27; can be safely deleted once the broadcast has gone out.
 */
export default async function BroadcastPage() {
  await requireRole(["admin", "superadmin"]);

  const sb = supabaseAdmin();
  const { data: teachers } = await sb
    .from("teachers")
    .select("id, users!inner(full_name, email, phone, active)")
    .eq("users.active", true)
    .order("id");

  type Row = {
    id: string;
    users: { full_name: string | null; email: string; phone: string | null; active: boolean } |
           Array<{ full_name: string | null; email: string; phone: string | null; active: boolean }>;
  };
  const list = ((teachers ?? []) as Row[]).map(r => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      teacher_id: r.id,
      name:       u?.full_name ?? "",
      email:      u?.email ?? "",
      phone:      u?.phone ?? null,
    };
  });

  // Render a sample preview using the first teacher's name, or a placeholder.
  const sample = list[0] ?? { name: "Nombre del profesor", email: "profe@aprender-aleman.de" };
  const preview = renderTeacherPlatformAnnouncement({
    name:        sample.name || "Nombre del profesor",
    email:       sample.email,
    platformUrl: PLATFORM_URL,
    videoUrl:    VIDEO_URL,
    cutoverDate: CUTOVER_DATE,
  });

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Broadcast a profesores — plataforma lista
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Envía el anuncio &quot;la nueva plataforma ya está lista&quot; a todos los profesores activos.
          Revisa la previsualización antes de pulsar enviar.
        </p>
      </header>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Destinatarios ({list.length})
        </h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No hay profesores activos.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {list.map(t => (
              <li key={t.teacher_id} className="py-2 flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {t.name || "(sin nombre)"}
                  </div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">{t.email}</div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {t.phone ?? "(sin WhatsApp)"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Previsualización
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Asunto: <strong className="text-slate-900 dark:text-slate-100">{preview.subject}</strong>
          </span>
        </div>
        <div className="mt-3 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700">
          <iframe
            title="Email preview"
            srcDoc={preview.html}
            sandbox=""
            className="w-full h-[720px] bg-white"
          />
        </div>
      </section>

      <BroadcastTrigger count={list.length} />
    </main>
  );
}
