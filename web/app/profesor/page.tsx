import { requireRole } from "@/lib/rbac";

export default async function TeacherHome() {
  const session = await requireRole(["teacher", "admin", "superadmin"]);
  const firstName = (session.user.name ?? session.user.email).split(/\s+/)[0];

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Hola, {firstName} 👋
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Esta es tu zona como profesor. Pronto verás aquí tus próximas clases,
          tus estudiantes y tu calendario.
        </p>
      </header>

      <Placeholder
        title="Próxima clase"
        body="Aquí aparecerá tu próxima clase con cuenta regresiva y botón para entrar al aula."
        emoji="📅"
      />
      <Placeholder
        title="Mis estudiantes"
        body="El listado de tus estudiantes (individuales y grupos) llegará en la siguiente fase."
        emoji="👥"
      />
      <Placeholder
        title="Ganancias del mes"
        body="Totales acumulados y detalle de horas trabajadas aparecerán cuando integremos pagos."
        emoji="💶"
      />
    </main>
  );
}

function Placeholder({ title, body, emoji }: { title: string; body: string; emoji: string }) {
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-2xl" aria-hidden>
          {emoji}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            Próximamente
          </span>
        </div>
      </div>
    </section>
  );
}
