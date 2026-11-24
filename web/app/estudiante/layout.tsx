import { signOut } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/nav/AppShell";
import { ImpersonationBanner } from "@/components/nav/ImpersonationBanner";
import { ImminentClassBannerLoader } from "@/components/classes/ImminentClassBannerLoader";
import { NAV_BY_ROLE, type NavItem } from "@/lib/nav-items";
import { getImpersonation } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { AsistenteWidget } from "@/components/asistente/AsistenteWidget";
import { asistenteLang, asistenteVisible } from "@/lib/asistente/config";

export const metadata = { title: "Estudiante · Aprender-Aleman.de" };

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const imp     = await getImpersonation();
  const display = (session.user.name ?? session.user.email ?? "Estudiante") as string;

  const effectiveRole = imp?.target_role === "student" ? "student" :
                        (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  // "Grabaciones" en el menú SOLO con el Bono de Acción Rápida
  // (students.recordings_enabled, Gelfis 2026-11-26). Bajo impersonación
  // se evalúa el alumno impersonado.
  const navUserId = imp?.target_role === "student" ? imp.target_id : session.user.id;
  let items: NavItem[] = NAV_BY_ROLE.student;
  try {
    const { data } = await supabaseAdmin()
      .from("students").select("recordings_enabled").eq("user_id", navUserId).maybeSingle();
    if ((data as { recordings_enabled?: boolean } | null)?.recordings_enabled) {
      const idx = items.findIndex(i => i.href === "/estudiante/certificados");
      const item: NavItem = { label: "Grabaciones", href: "/estudiante/grabaciones", icon: "video", priority: 5.5 };
      items = idx >= 0
        ? [...items.slice(0, idx), item, ...items.slice(idx)]
        : [...items, item];
    }
  } catch { /* sin flag no hay entrada — nunca romper el layout */ }

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
      <ImminentClassBannerLoader />
      <AppShell
        items={items}
        role={effectiveRole}
        userDisplayName={display}
        impersonated={Boolean(imp)}
        logoutForm={logoutForm}
      >
        {children}
      </AppShell>
      {/* Asistente IA: solo para la sesión real del rol (no en "Ver como"). */}
      {!imp && session.user.role === "student" && asistenteVisible("student") && (
        <AsistenteWidget rol="student" nombre={display.split(/\s+/)[0] ?? ""} userId={session.user.id} lang={await asistenteLang(session.user.id)} />
      )}
    </>
  );
}
