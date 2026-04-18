import Link from "next/link";
import { getLeads, type LeadsFilter } from "@/lib/dashboard";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Todos los leads · Admin" };

const PAGE_SIZE = 50;

type SP = Promise<Record<string, string | string[] | undefined>>;

// Spanish labels for status values (kept in sync with StatusBadge)
const STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  contacted_1: "Contacto 1",
  contacted_2: "Contacto 2",
  contacted_3: "Contacto 3",
  contacted_4: "Contacto 4",
  in_conversation: "En conversación",
  link_sent: "Enlace enviado",
  trial_scheduled: "Clase agendada",
  trial_reminded: "Recordatorio enviado",
  trial_absent: "No asistió",
  absent_followup_1: "Reenganche 1",
  absent_followup_2: "Reenganche 2",
  absent_followup_3: "Reenganche 3",
  needs_human: "Requiere humano",
  converted: "Convertido",
  cold: "Frío",
  lost: "Perdido",
};

const GOAL_LABELS: Record<string, string> = {
  work: "Trabajar",
  visa: "Visa / residencia",
  studies: "Estudios",
  exam: "Examen oficial",
  travel: "Viajes",
  already_in_dach: "Ya vivo en DACH",
};

const URGENCY_LABELS: Record<string, string> = {
  asap: "Lo antes posible",
  under_3_months: "< 3 meses",
  in_6_months: "6 meses",
  next_year: "Próximo año",
  just_looking: "Solo viendo",
};

export default async function AllLeadsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;

  const toArray = (v: string | string[] | undefined): string[] | undefined => {
    if (!v) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    const clean = arr.filter(Boolean);
    return clean.length ? clean : undefined;
  };

  const page = Math.max(1, Number(sp.page ?? 1));
  const filter: LeadsFilter = {
    status:        toArray(sp.status),
    goal:          toArray(sp.goal),
    urgency:       toArray(sp.urgency),
    german_level:  toArray(sp.level),
    language:      sp.lang === "es" || sp.lang === "de" ? sp.lang : undefined,
    has_trial:     sp.trial === "yes" || sp.trial === "no" ? sp.trial : undefined,
    q:             typeof sp.q === "string" ? sp.q : undefined,
    limit:         PAGE_SIZE,
    offset:        (page - 1) * PAGE_SIZE,
  };

  const { rows, total } = await getLeads(filter);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Todos los leads</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{total.toLocaleString("es-ES")} resultado{total === 1 ? "" : "s"}</p>
        </div>
      </header>

      <form method="get" className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 grid gap-3 sm:grid-cols-4">
        <input
          name="q"
          defaultValue={filter.q ?? ""}
          placeholder="Buscar por nombre o teléfono…"
          className="input-text sm:col-span-2"
        />
        <select name="status" defaultValue={(filter.status?.[0] ?? "") as string} className="input-text">
          <option value="">Todos los estados</option>
          {[
            "new","contacted_1","contacted_2","contacted_3","contacted_4",
            "in_conversation","link_sent","trial_scheduled","trial_reminded",
            "trial_absent","absent_followup_1","absent_followup_2","absent_followup_3",
            "needs_human","converted","cold","lost",
          ].map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
        </select>
        <select name="goal" defaultValue={(filter.goal?.[0] ?? "") as string} className="input-text">
          <option value="">Todos los objetivos</option>
          {["work","visa","studies","exam","travel","already_in_dach"]
            .map((g) => <option key={g} value={g}>{GOAL_LABELS[g] ?? g}</option>)}
        </select>
        <select name="urgency" defaultValue={(filter.urgency?.[0] ?? "") as string} className="input-text">
          <option value="">Toda la urgencia</option>
          {["asap","under_3_months","in_6_months","next_year","just_looking"]
            .map((u) => <option key={u} value={u}>{URGENCY_LABELS[u] ?? u}</option>)}
        </select>
        <select name="level" defaultValue={(filter.german_level?.[0] ?? "") as string} className="input-text">
          <option value="">Todos los niveles</option>
          {["A0","A1-A2","B1","B2+"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select name="lang" defaultValue={filter.language ?? ""} className="input-text">
          <option value="">Cualquier idioma</option>
          <option value="es">ES</option>
          <option value="de">DE</option>
        </select>
        <select name="trial" defaultValue={filter.has_trial ?? ""} className="input-text">
          <option value="">¿Con clase agendada?</option>
          <option value="yes">Con clase</option>
          <option value="no">Sin clase</option>
        </select>
        <button type="submit" className="btn-primary">Filtrar</button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
            <tr>
              <Th>Nombre</Th>
              <Th>WhatsApp</Th>
              <Th>Estado</Th>
              <Th>Nivel</Th>
              <Th>Objetivo</Th>
              <Th>Urgencia</Th>
              <Th>Idioma</Th>
              <Th>#</Th>
              <Th>Próximo contacto</Th>
              <Th>Clase</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-slate-500 dark:text-slate-400">No hay leads que coincidan.</td></tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                <Td>
                  <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                    {l.name || "—"}
                  </Link>
                </Td>
                <Td><code className="text-xs">{l.whatsapp_normalized}</code></Td>
                <Td><StatusBadge status={l.status} /></Td>
                <Td>{l.german_level}</Td>
                <Td>{GOAL_LABELS[l.goal] ?? l.goal}</Td>
                <Td>{URGENCY_LABELS[l.urgency] ?? l.urgency}</Td>
                <Td>{l.language}</Td>
                <Td>{l.current_followup_number}</Td>
                <Td>
                  {l.next_contact_date
                    ? new Date(l.next_contact_date).toLocaleDateString("es-ES")
                    : "—"}
                </Td>
                <Td>
                  {l.trial_scheduled_at
                    ? new Date(l.trial_scheduled_at).toLocaleDateString("es-ES")
                    : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} sp={sp} />
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 whitespace-nowrap">{children}</td>;
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
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
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
