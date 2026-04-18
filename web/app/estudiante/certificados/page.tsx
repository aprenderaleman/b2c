import { requireRole } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { listStudentCertificates } from "@/lib/certificates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificados · Estudiante" };

export default async function StudentCertificatesPage() {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const student = await getStudentByUserId(session.user.id);

  if (!student) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Certificados</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de estudiante.
        </p>
      </main>
    );
  }

  const certs = await listStudentCertificates(student.id);

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis certificados</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Se generan automáticamente cuando cruzas hitos (50 clases, niveles CEFR)
          y manualmente cuando apruebas un examen oficial.
        </p>
      </header>

      {certs.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-8 text-center">
          <div className="text-5xl" aria-hidden>🎓</div>
          <p className="mt-3 text-slate-600 dark:text-slate-300 font-medium">Aún no tienes certificados.</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Tu primer hito: 50 clases con asistencia.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          {certs.map(c => (
            <article
              key={c.id}
              className="rounded-3xl border border-brand-200 dark:border-brand-500/30 bg-gradient-to-br from-white to-brand-50/60 dark:from-slate-900 dark:to-brand-500/5 p-6"
            >
              <div className="flex items-start gap-4">
                <div className="text-4xl" aria-hidden>🏅</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">{c.title}</h3>
                  {c.description && (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{c.description}</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Emitido el {new Date(c.issued_at).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })}
                  </p>
                </div>
              </div>
              <a
                href={`/api/certificates/${c.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-sm mt-4 inline-flex"
              >
                Descargar PDF
              </a>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
