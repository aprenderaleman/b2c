import { requireRoleWithImpersonation } from "@/lib/rbac";
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi perfil · Aprender-Aleman.de" };

/** Perfil del profesor (Gelfis 2026-10-29): datos de la cuenta +
 *  cambio de contraseña self-service. */
export default async function TeacherProfilePage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
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
