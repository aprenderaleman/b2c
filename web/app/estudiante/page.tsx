import { requireRole } from "@/lib/rbac";

export default async function StudentHome() {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const firstName = (session.user.name ?? session.user.email).split(/\s+/)[0];

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          ¡Hola, {firstName}! 🇩🇪
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Esta es tu plataforma de aprendizaje. Pronto verás aquí tus clases,
          grabaciones, tareas y el chat con tu profesor.
        </p>
      </header>

      {/* Quick access to external tools that already exist */}
      <section className="grid gap-4 sm:grid-cols-2">
        <ExternalCard
          emoji="🎓"
          title="SCHULE"
          body="Tu aula virtual — ejercicios, audios, gramática y vocabulario autoevaluable."
          href="https://schule.aprender-aleman.de"
        />
        <ExternalCard
          emoji="🤖"
          title="HANS"
          body="Tu profesor de IA disponible 24/7. Practica conversación por voz o texto cuando quieras."
          href="https://hans.aprender-aleman.de"
        />
      </section>

      <Placeholder
        title="Próxima clase"
        body="Tu siguiente clase aparecerá aquí con cuenta regresiva y botón para entrar al aula."
        emoji="📅"
      />
      <Placeholder
        title="Grabaciones"
        body="Podrás volver a ver tus clases pasadas cuando el sistema de grabación esté activo."
        emoji="📼"
      />
      <Placeholder
        title="Tu plan"
        body="Consulta aquí tu tipo de suscripción, clases restantes y facturas."
        emoji="📋"
      />
    </main>
  );
}

function ExternalCard({ emoji, title, body, href }: {
  emoji: string; title: string; body: string; href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-3xl bg-white dark:bg-slate-900
                 border border-slate-200 dark:border-slate-800
                 p-6 block
                 transition-all hover:-translate-y-0.5 hover:shadow-brand
                 hover:border-brand-400 dark:hover:border-brand-500"
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-2xl" aria-hidden>
          {emoji}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {title} <span aria-hidden className="text-sm font-normal text-slate-400">↗</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
        </div>
      </div>
    </a>
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
