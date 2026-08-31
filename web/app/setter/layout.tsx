import { auth, signOut } from "@/lib/auth";
import { AppShell } from "@/components/nav/AppShell";
import { ImpersonationBanner } from "@/components/nav/ImpersonationBanner";
import { NAV_BY_ROLE } from "@/lib/nav-items";
import { getImpersonation } from "@/lib/impersonation";

export const metadata = { title: "Setter · Aprender-Aleman.de" };

export default async function SetterLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const imp = await getImpersonation();

  const isSetter = role === "setter";
  const isAdminImpersonating =
    (role === "admin" || role === "superadmin") && imp?.target_role === "setter";

  if (!session?.user || (!isSetter && !isAdminImpersonating)) {
    return <>{children}</>;
  }

  const display = isAdminImpersonating
    ? imp!.target_name
    : ((session.user.name ?? session.user.email ?? "Setter") as string);

  const logoutForm = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button type="submit">Cerrar sesion</button>
    </form>
  );

  return (
    <>
      {isAdminImpersonating && (
        <ImpersonationBanner
          adminName={imp!.admin_name}
          targetName={imp!.target_name}
          targetRole={imp!.target_role}
        />
      )}
      <AppShell
        items={NAV_BY_ROLE.setter}
        role="setter"
        userDisplayName={display}
        impersonated={isAdminImpersonating}
        logoutForm={logoutForm}
      >
        {children}
      </AppShell>
    </>
  );
}
