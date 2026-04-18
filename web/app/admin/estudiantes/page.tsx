import Link from "next/link";
import { getStudents, moneyFromCents, subscriptionStatusEs, subscriptionTypeEs } from "@/lib/academy";

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
    limit:             PAGE_SIZE,
    offset:            (page - 1) * PAGE_SIZE,
  };

  const { rows, total } = await getStudents(filter);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Estudiantes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {total.toLocaleString("es-ES")} resultado{total === 1 ? "" : "s"}
          </p>
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
          <option value="">Cualquier plan</option>
          <option value="single_classes">Clases sueltas</option>
          <option value="package">Paquete</option>
          <option value="monthly_subscription">Suscripción mensual</option>
          <option value="combined">Combinado</option>
        </select>
        <select name="level" defaultValue={filter.level ?? ""} className="input-text">
          <option value="">Cualquier nivel</option>
          {["A0","A1","A2","B1","B2","C1","C2"].map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary">Filtrar</button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Nivel</Th>
              <Th>Plan</Th>
              <Th>Estado</Th>
              <Th>Clases restantes</Th>
              <Th>Convertido</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Aún no hay estudiantes.
                  <br />
                  <span className="text-xs">
                    Convierte un lead desde{" "}
                    <Link href="/admin/leads" className="text-brand-600 dark:text-brand-400 hover:underline">
                      Todos los leads
                    </Link>
                    .
                  </span>
                </td>
              </tr>
            )}
            {rows.map(s => (
              <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                <Td>
                  <Link href={`/admin/estudiantes/${s.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                    {s.full_name || "—"}
                  </Link>
                </Td>
                <Td><code className="text-xs">{s.email}</code></Td>
                <Td>{s.current_level}</Td>
                <Td>{subscriptionTypeEs(s.subscription_type)}</Td>
                <Td>
                  <StatusDot status={s.subscription_status} />
                </Td>
                <Td>
                  {s.subscription_type === "monthly_subscription"
                    ? <span className="text-slate-500 dark:text-slate-400">
                        {s.classes_per_month ?? "?"}/mes · {moneyFromCents(s.monthly_price_cents, s.currency)}
                      </span>
                    : s.classes_remaining}
                </Td>
                <Td>{new Date(s.converted_at).toLocaleDateString("es-ES")}</Td>
              </tr>
            ))}
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
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 whitespace-nowrap">{children}</td>;
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
