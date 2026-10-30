import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { getUserIcalToken, icalUrlFor } from "@/lib/user-extras";
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard";
import { PlanSection } from "@/components/student/PlanSection";
import { OpenSchuleButton } from "@/components/entitlements/OpenSchuleButton";
import { OpenHansButton } from "@/components/entitlements/OpenHansButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi perfil · Aprender-Aleman.de" };

/** Perfil del estudiante (Gelfis 2026-10-29): datos de la cuenta +
 *  cambio de contraseña self-service (caso Adrián).
 *  2026-10-30: la tarjeta "Tu plan" se muestra aquí (antes en Hoy) y las
 *  tarjetas de acceso a SCHULE y HANS (las mismas que en Hoy). */
export default async function StudentProfilePage() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );

  const student = await getStudentByUserId(session.user.id);
  const icalToken = student ? await getUserIcalToken(session.user.id) : null;

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi perfil</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {session.user.name} · <code>{session.user.email}</code>
        </p>
      </header>
      {student && (
        <PlanSection student={student} icalUrl={icalToken ? icalUrlFor(icalToken) : null} />
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tus herramientas</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <OpenSchuleButton />
          <OpenHansButton />
        </div>
      </section>
      <ChangePasswordCard />
    </main>
  );
}
