import { signOut } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/nav/AppShell";
import { ImpersonationBanner } from "@/components/nav/ImpersonationBanner";
import { NAV_BY_ROLE } from "@/lib/nav-items";
import { getImpersonation } from "@/lib/impersonation";

export const metadata = { title: "Estudiante · Aprender-Aleman.de" };

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const imp     = await getImpersonation();
  const display = (session.user.name ?? session.user.email ?? "Estudiante") as string;

  // If admin is impersonating a student, render as the student role;
  // otherwise use their own role.
  const effectiveRole = imp?.target_role === "student" ? "student" :
                        (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

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
        items={NAV_BY_ROLE.student}
        role={effectiveRole}
        userDisplayName={display}
        impersonated={Boolean(imp)}
        logoutForm={logoutForm}
      >
        {children}
      </AppShell>
    </>
  );
}
