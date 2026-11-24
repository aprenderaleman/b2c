import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getSetterUrgentes } from "@/lib/setter-urgentes";
import { SetterUrgentesTabs } from "@/components/setter/SetterUrgentesTabs";

export const metadata = { title: "Leads Urgentes · Setter" };
export const dynamic = "force-dynamic";

export default async function SetterUrgentesPage() {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter" && session.user.role !== "admin" && session.user.role !== "superadmin") {
    redirect("/");
  }

  const { hoy, manana, calientes } = await getSetterUrgentes();

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Leads Urgentes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Citas de hoy y de mañana con la fecha del último contacto — para dar un
          toque más a quien lleva días sin saber de nosotros.
        </p>
      </header>

      <SetterUrgentesTabs hoy={hoy} manana={manana} calientes={calientes} />
    </main>
  );
}
