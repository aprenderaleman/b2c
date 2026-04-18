import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { CreateAdminForm } from "@/components/admin/CreateAdminForm";

export const metadata = { title: "Nuevo admin · Admin" };

/**
 * Superadmin-only page: creates another admin user. Regular admins get
 * redirected back to /admin (the API endpoint double-checks anyway).
 */
export default async function NewAdminPage() {
  const session = await requireRole(["superadmin", "admin"]);

  // If caller is just an admin (not superadmin), bounce them — the UI for
  // creating admins only makes sense for the owner account.
  let role = session.user.role;
  const sb = supabaseAdmin();
  const { data } = await sb.from("users").select("role").eq("email", session.user.email).maybeSingle();
  if (data?.role) role = data.role as typeof role;
  if (role !== "superadmin") redirect("/admin");

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al admin
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Crear admin</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Añade un administrador que podrá gestionar leads, estudiantes y profesores.
          Sólo tú (superadmin) puedes crear admins.
        </p>
      </div>
      <CreateAdminForm />
    </main>
  );
}
