import Link from "next/link";
import { getStudents, getStudentsOverview, goalLevelEs, ritmoLabelEs, subscriptionStatusEs } from "@/lib/academy";
import { adminDriveStatus } from "@/lib/admin-google-drive";
import RefreshButton from "./RefreshButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estudiantes · Admin" };

const PAGE_SIZE = 50;

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function StudentsListPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  const filter = {
    q:                 typeof sp.q      === "string" ? sp.q      : undefined,
    status:            typeof sp.status === "string" ? sp.status : undefined,
    subscription_type: typeof sp.type   === "string" ? sp.type   : undefined,
    level:             typeof sp.level  === "string" ? sp.level  : undefined,
    include_inactive:  sp.inactivos === "1",
    limit:             PAGE_SIZE,
    offset:            (page - 1) * PAGE_SIZE,
  };

  const { rows, total } = await getStudents(filter);
  const [overview, drive] = await Promise.all([
    getStudentsOverview(rows.map(r => r.id)),
    adminDriveStatus(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const driveFlash = typeof sp.google_drive === "string" ? sp.google_drive : null;

  return (
    <main className="space-y-5">
      {driveFlash === "connected" && (
        <p className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-4 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          Google Drive conectado. Los documentos de apuntes que falten se crean en el próximo cron (o ahora, si lo lanzas).
        </p>
      )}
      {driveFlash === "error" && (
        <p className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-2 text-sm text-red-800 dark:text-red-200">
          No se pudo conectar Google Drive ({typeof sp.reason === "string" ? sp.reason : "error"}). Inténtalo de nuevo.
        </p>
      )}
      {!drive.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          <span>
            <strong>Documentos de apuntes desactivados:</strong> conecta tu Google Drive para que cada alumno nuevo reciba su "Apuntes de Clase" automáticamente.
          </span>
          <a href="/api/admin/google-drive/connect" className="btn-primary text-xs whitespace-nowrap">Conectar Google Drive</a>
        </div>
      )}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Estudiantes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {total.toLocaleString("es-ES")} resultado{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {drive.connected && (
            <span className="text-xs text-slate-500 dark:text-slate-400" title={`Conectado desde ${drive.since ?? ""}`}>
              Drive: {drive.email ?? "conectado"}
            </span>
          )}
          <RefreshButton />
          <a
            href="/admin/estudiantes/nuevo"
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white"
          >
            + Nuevo estudiante
          </a>
        </div>
      </header>

      <form method="get" className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 grid gap-3 sm:grid-cols-4">
        <input
          name="q"
          defaultValue={filter.q ?? ""}
          placeholder="Buscar por nombre o correo…"
          className="input-text sm:col-span-2"
        />
        <select name="status" defaultValue={filter.status ?? ""} className="input-text">
          <option value="">Cualquier estado</option>
          <option value="active">Activa</option>
          <option value="paused">Pausada</option>
          <option value="cancelled">Cancelada</option>
          <option value="expired">Expirada</option>
        </select>
        <select name="type" defaultValue={filter.subscription_type ?? ""} className="input-text">
          <option value="">Cualquier tipo de pago</option>
          <option value="single_classes">Clases sueltas</option>
          <option value="package">Paquete</option>
          <option value="monthly_subscription">Suscripción mensual</option>
          <option value="combined">Combinado</option>
        </select>
        <select name="level" defaultValue={filter.level ?? ""} className="input-text">
          <option value="">Cualquier nivel</option>
          {["A1","A2","B1","B2","C1"].map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 sm:col-span-3">
          <input
            type="checkbox"
            name="inactivos"
            value="1"
            defaultChecked={filter.include_inactive}
            className="rounded border-slate-300 dark:border-slate-700"
          />
          Mostrar también estudiantes dados de baja
        </label>
        <button type="submit" className="btn-primary">Filtrar</button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
            <tr>
              <Th>Nombre</Th>
              <Th>Profe</Th>
              <Th>Nivel → Meta</Th>
              <Th>Ritmo</Th>
              <Th>Estado</Th>
              <Th>Progreso</Th>
              <Th>Restantes</Th>
              <Th>Desde</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Aún no hay estudiantes.
                  <br />
                  <span className="text-xs">
                    Convierte un lead desde{" "}
                    <Link href="/admin/funnel" className="text-brand-600 dark:text-brand-400 hover:underline">
                      el Funnel
                    </Link>
                    .
                  </span>
                </td>
              </tr>
            )}
            {rows.map(s => {
              const ov = overview[s.id] ?? { completed: 0, teacher: null };
              const total = s.clases_totales ?? 0;
              // Packs viejos se ajustaron a mano (unidades de 50 min, grupales que no cuentan…):
              // el saldo real es totales − restantes, no el conteo bruto de clases completadas.
              const done = total > 0 ? Math.max(0, total - s.classes_remaining) : ov.completed;
              const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
              return (
                <tr key={s.id} className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 ${s.active ? "" : "opacity-50"}`}>
                  <Td>
                    <Link href={`/admin/estudiantes/${s.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                      {s.full_name || "—"}
                    </Link>
                    <div className="text-xs text-slate-400"><code>{s.email}</code></div>
                  </Td>
                  <Td>{ov.teacher ?? <span className="text-slate-400">—</span>}</Td>
                  <Td>
                    <span className="font-medium">{s.current_level}</span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="font-medium">{goalLevelEs(s.goal)}</span>
                  </Td>
                  <Td>{ritmoLabelEs(s)}</Td>
                  <Td><StatusDot status={s.subscription_status} /></Td>
                  <Td>
                    {total > 0 ? (
                      <div className="flex items-center gap-2" title={`${ov.completed} clases completadas en la plataforma`}>
                        <div className="h-1.5 w-20 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="tabular-nums text-xs text-slate-600 dark:text-slate-300">
                          {done}/{total} · {pct}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">{ov.completed} hechas</span>
                    )}
                  </Td>
                  <Td>
                    <span className={`tabular-nums font-medium ${s.classes_remaining <= 4 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {s.classes_remaining}
                    </span>
                  </Td>
                  <Td className="text-xs text-slate-500">{new Date(s.converted_at).toLocaleDateString("es-ES")}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} sp={sp} />}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active"    ? "bg-emerald-500" :
    status === "paused"    ? "bg-amber-500"   :
    status === "cancelled" ? "bg-slate-400"   :
    status === "expired"   ? "bg-red-500"     : "bg-slate-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="text-xs text-slate-700 dark:text-slate-300">{subscriptionStatusEs(status)}</span>
    </span>
  );
}

function Pagination({ page, totalPages, sp }: {
  page: number;
  totalPages: number;
  sp: Record<string, string | string[] | undefined>;
}) {
  const qs = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "page") continue;
      if (Array.isArray(v)) v.forEach(x => params.append(k, x));
      else if (v) params.set(k, v);
    }
    params.set("page", String(p));
    return "?" + params.toString();
  };
  return (
    <nav className="flex items-center justify-center gap-2 text-sm">
      {page > 1 && <Link href={qs(page - 1)} className="btn-secondary text-xs">← Anterior</Link>}
      <span className="text-slate-600 dark:text-slate-300">Página {page} / {totalPages}</span>
      {page < totalPages && <Link href={qs(page + 1)} className="btn-secondary text-xs">Siguiente →</Link>}
    </nav>
  );
}
