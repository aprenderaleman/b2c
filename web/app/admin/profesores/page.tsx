import Link from "next/link";
import { getTeachers } from "@/lib/academy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profesores · Admin" };

export default async function TeachersListPage() {
  const rows = await getTeachers();

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Profesores</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {rows.length.toLocaleString("es-ES")} profesor{rows.length === 1 ? "" : "es"}
          </p>
        </div>
        <Link href="/admin/profesores/nuevo" className="btn-primary text-sm">
          + Añadir profesor
        </Link>
      </header>

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Idiomas</Th>
              <Th>Especialidades</Th>
              <Th>Tarifa</Th>
              <Th>Estado</Th>
              <Th>Creado</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Aún no hay profesores. Crea el primero con el botón de arriba.
                </td>
              </tr>
            )}
            {rows.map(t => (
              <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                <Td>
                  <Link href={`/admin/profesores/${t.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                    {t.full_name || "—"}
                  </Link>
                </Td>
                <Td><code className="text-xs">{t.email}</code></Td>
                <Td>{t.languages_spoken.join(", ") || "—"}</Td>
                <Td>{t.specialties.join(", ") || "—"}</Td>
                <Td>
                  {t.hourly_rate
                    ? `${Number(t.hourly_rate).toFixed(2)} ${t.currency}/h`
                    : <span className="text-slate-400">—</span>}
                </Td>
                <Td>
                  <span className={`inline-flex items-center gap-1.5`}>
                    <span className={`h-2 w-2 rounded-full ${t.active ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden />
                    <span className="text-xs">{t.active ? "Activo" : "Inactivo"}</span>
                  </span>
                </Td>
                <Td>{new Date(t.created_at).toLocaleDateString("es-ES")}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 whitespace-nowrap">{children}</td>;
}
