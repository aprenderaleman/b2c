import { requireRoleWithImpersonation } from "@/lib/rbac";
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi perfil · Aprender-Aleman.de" };

/** Perfil del estudiante (Gelfis 2026-10-29): datos de la cuenta +
 *  cambio de contraseña self-service (caso Adrián). */
export default async function StudentProfilePage() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi perfil</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {session.user.name} · <code>{session.user.email}</code>
        </p>
      </header>
      <ChangePasswordCard />
    </main>
  );
}
