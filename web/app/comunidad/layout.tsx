import { signOut } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/nav/AppShell";
import { ImpersonationBanner } from "@/components/nav/ImpersonationBanner";
import { NAV_BY_ROLE } from "@/lib/nav-items";
import { getImpersonation } from "@/lib/impersonation";
import type { Role } from "@/lib/rbac";

export const metadata = { title: "Comunidad · Aprender-Aleman.de" };

export default async function CommunityLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["student", "teacher", "admin", "superadmin"]);
  const imp     = await getImpersonation();
  const display = (session.user.name ?? session.user.email ?? "Usuario") as string;

  const role = (imp?.target_role ?? session.user.role) as Role;

  const navItems = role === "teacher"
    ? NAV_BY_ROLE.teacher
    : role === "student"
      ? NAV_BY_ROLE.student
      : NAV_BY_ROLE.admin;

  const logoutForm = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button type="submit">Cerrar sesión</button>
    </form>
  );

  return (
    <>
      {imp && (
        <ImpersonationBanner
          adminName={imp.admin_name}
          targetName={imp.target_name}
          targetRole={imp.target_role}
        />
      )}
      <AppShell
        items={navItems}
        role={role}
        userDisplayName={display}
        impersonated={Boolean(imp)}
        logoutForm={logoutForm}
      >
        {children}
      </AppShell>
    </>
  );
}
