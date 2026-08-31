import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata = { title: "Perfil · Setter" };

export default async function SetterPerfilPage() {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("full_name, email, phone, created_at")
    .eq("id", session.user.id)
    .maybeSingle();
  const u = (data ?? {}) as { full_name?: string | null; email?: string; phone?: string | null; created_at?: string };

  return (
    <main className="space-y-5 max-w-xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi perfil</h1>
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2 text-sm">
        <p><span className="text-slate-500 dark:text-slate-400">Nombre:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{u.full_name ?? "—"}</span></p>
        <p><span className="text-slate-500 dark:text-slate-400">Email:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{u.email ?? "—"}</span></p>
        <p><span className="text-slate-500 dark:text-slate-400">Teléfono:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{u.phone ?? "—"}</span></p>
      </section>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Tu rol: confirmar, recordar y rescatar citas por voz desde tu propio
        WhatsApp. Cada contacto se registra con nota en el perfil del lead.
      </p>
    </main>
  );
}
