import { signOut } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/nav/AppShell";
import { ImpersonationBanner } from "@/components/nav/ImpersonationBanner";
import { ImminentClassBanner } from "@/components/classes/ImminentClassBanner";
import { NAV_BY_ROLE } from "@/lib/nav-items";
import { getImpersonation } from "@/lib/impersonation";
import { getTeacherByUserId } from "@/lib/academy";
import { getImminentClassForTeacher } from "@/lib/imminent-class";

export const metadata = { title: "Profesor · Aprender-Aleman.de" };

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["teacher", "admin", "superadmin"]);
  const imp     = await getImpersonation();
  const display = (session.user.name ?? session.user.email ?? "Profesor") as string;

  const effectiveRole = imp?.target_role === "teacher" ? "teacher" :
                        (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const teacher = await getTeacherByUserId(session.user.id);
  const imminent = teacher ? await getImminentClassForTeacher(teacher.id) : null;

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
      {imminent && (
        <ImminentClassBanner
          classId={imminent.id}
          title={imminent.title}
          scheduledAt={imminent.scheduled_at}
          durationMinutes={imminent.duration_minutes}
        />
      )}
      <AppShell
        items={NAV_BY_ROLE.teacher}
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
