import { auth, signOut } from "@/lib/auth";
import { AppShell } from "@/components/nav/AppShell";
import { ImpersonationBanner } from "@/components/nav/ImpersonationBanner";
import { SystemHealthBanner } from "@/components/admin/SystemHealthBanner";
import { NAV_BY_ROLE } from "@/lib/nav-items";
import { getImpersonation } from "@/lib/impersonation";

export const metadata = { title: "Admin · Aprender-Aleman.de" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role    = (session?.user as { role?: "superadmin" | "admin" | "teacher" | "student" } | undefined)?.role;
  const display = (session?.user?.name ?? session?.user?.email ?? "Admin") as string;
  const imp     = await getImpersonation();

  // If a non-admin somehow lands here, send them to the login redirector;
  // middleware should already prevent this but belt-and-suspenders.
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return <>{children}</>;
  }

  const items = NAV_BY_ROLE[role];

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
        items={items}
        role={role}
        userDisplayName={display}
        impersonated={Boolean(imp)}
        logoutForm={logoutForm}
      >
        <SystemHealthBanner />
        {children}
      </AppShell>
    </>
  );
}
