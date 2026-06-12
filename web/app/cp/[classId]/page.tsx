import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getClassContext, startOrLoadScript, canAccessTrialScript,
} from "@/lib/trial-script";
import { TrialScriptWizard } from "./TrialScriptWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guion de clase de prueba · /cp" };

/**
 * /cp/[classId] — guion + captura de datos para el profesor durante
 * la clase de prueba.
 *
 * Acceso: profe asignado a la clase + superadmin. Otros caen a 404
 * para no filtrar la existencia de la clase.
 */
export default async function TrialScriptPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?next=${encodeURIComponent(`/cp/${classId}`)}`);
  }
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const ctx = await getClassContext(classId);
  if (!ctx) notFound();

  if (!canAccessTrialScript(ctx, userId, role)) {
    notFound();
  }

  // Crea el script si no existe (idempotente). El teacher_id que
  // queda registrado es el de la clase, no el del user que abre — en
  // caso de superadmin viendo el guion el dato sigue siendo
  // atribuible al profe correcto.
  const script = await startOrLoadScript(ctx.classId, ctx.leadId, ctx.teacherUserId);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-6">
      <TrialScriptWizard
        scriptId={script.id}
        classCtx={ctx}
        initial={script}
      />
    </main>
  );
}
