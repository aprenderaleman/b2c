import { notFound, redirect } from "next/navigation";
import Link from "next/link";
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

  let ctx;
  try {
    ctx = await getClassContext(classId);
  } catch (e) {
    return <DiagnosticErrorScreen
      title="Error al cargar la clase"
      detail={e instanceof Error ? e.message : String(e)}
      classId={classId}
    />;
  }
  if (!ctx) notFound();

  if (!canAccessTrialScript(ctx, userId, role)) {
    notFound();
  }

  // Crea el script si no existe (idempotente). El teacher_id que
  // queda registrado es el de la clase, no el del user que abre — en
  // caso de superadmin viendo el guion el dato sigue siendo
  // atribuible al profe correcto.
  let script;
  try {
    script = await startOrLoadScript(ctx.classId, ctx.leadId, ctx.teacherUserId);
  } catch (e) {
    return <DiagnosticErrorScreen
      title="Error al crear el guion en BD"
      detail={e instanceof Error ? e.message : String(e)}
      classId={classId}
      hint={
        e instanceof Error && /trial_class_scripts.*does not exist|42P01/i.test(e.message)
          ? "La tabla trial_class_scripts no existe. Aplica la migración 058_trial_class_scripts.sql en Supabase Dashboard → SQL Editor."
          : undefined
      }
    />;
  }

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

/**
 * Pantalla de diagnóstico con el error real cuando algo falla
 * server-side. Reemplaza la "Application error" genérica de Next por
 * algo accionable. Solo visible a usuarios logueados (la página ya
 * exige sesión arriba).
 */
function DiagnosticErrorScreen({
  title, detail, classId, hint,
}: {
  title:   string;
  detail:  string;
  classId: string;
  hint?:   string;
}) {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-10">
      <div className="max-w-2xl mx-auto rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 p-6 md:p-8 shadow-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-50">
          {title}
        </h1>
        {hint && (
          <div className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            💡 {hint}
          </div>
        )}
        <p className="mt-4 text-xs uppercase tracking-wider text-slate-500">Detalle técnico</p>
        <pre className="mt-1 rounded-lg bg-slate-900 text-slate-100 text-xs leading-snug p-3 overflow-x-auto whitespace-pre-wrap break-words">
{detail}
        </pre>
        <p className="mt-3 text-xs text-slate-500">
          ClassId: <code className="font-mono">{classId}</code>
        </p>
        <div className="mt-6 flex gap-2">
          <Link
            href="/admin/clasedeprueba"
            className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ← Volver
          </Link>
        </div>
      </div>
    </main>
  );
}
