import { auth, signOut } from "@/lib/auth";
import { AppShell } from "@/components/nav/AppShell";
import { NAV_BY_ROLE } from "@/lib/nav-items";

export const metadata = { title: "Closer · Aprender-Aleman.de" };

export default async function CloserLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const display = (session?.user?.name ?? session?.user?.email ?? "Closer") as string;

  if (!session?.user || role !== "closer") {
    return <>{children}</>;
  }

  const items = NAV_BY_ROLE.closer;

  const logoutForm = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button type="submit">Cerrar sesion</button>
    </form>
  );

  return (
    <AppShell
      items={items}
      role={role}
      userDisplayName={display}
      impersonated={false}
      logoutForm={logoutForm}
    >
      {children}
    </AppShell>
  );
}
