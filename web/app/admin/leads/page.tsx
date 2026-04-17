import Link from "next/link";
import { getLeads, type LeadsFilter } from "@/lib/dashboard";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic";
export const metadata = { title: "All leads · Admin" };

const PAGE_SIZE = 50;

type SP = Promise<Record<string, string | string[] | undefined>>;

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
          <h1 className="text-2xl font-bold text-slate-900">All leads</h1>
          <p className="text-sm text-slate-500">{total.toLocaleString()} result{total === 1 ? "" : "s"}</p>
        </div>
      </header>

      <form method="get" className="rounded-2xl bg-white border border-slate-200 p-4 grid gap-3 sm:grid-cols-4">
        <input
          name="q"
          defaultValue={filter.q ?? ""}
          placeholder="Search name or phone…"
          className="input-text sm:col-span-2"
        />
        <select name="status" defaultValue={(filter.status?.[0] ?? "") as string} className="input-text">
          <option value="">All statuses</option>
          {[
            "new","contacted_1","contacted_2","contacted_3","contacted_4",
            "in_conversation","link_sent","trial_scheduled","trial_reminded",
            "trial_absent","absent_followup_1","absent_followup_2","absent_followup_3",
            "needs_human","converted","cold","lost",
          ].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="goal" defaultValue={(filter.goal?.[0] ?? "") as string} className="input-text">
          <option value="">All goals</option>
          {["work","visa","studies","exam","travel","already_in_dach"]
            .map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select name="urgency" defaultValue={(filter.urgency?.[0] ?? "") as string} className="input-text">
          <option value="">All urgency</option>
          {["asap","under_3_months","in_6_months","next_year","just_looking"]
            .map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select name="level" defaultValue={(filter.german_level?.[0] ?? "") as string} className="input-text">
          <option value="">All levels</option>
          {["A0","A1-A2","B1","B2+"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select name="lang" defaultValue={filter.language ?? ""} className="input-text">
          <option value="">Any lang</option>
          <option value="es">ES</option>
          <option value="de">DE</option>
        </select>
        <select name="trial" defaultValue={filter.has_trial ?? ""} className="input-text">
          <option value="">Trial scheduled?</option>
          <option value="yes">With trial</option>
          <option value="no">Without trial</option>
        </select>
        <button type="submit" className="btn-primary">Filter</button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <Th>Name</Th>
              <Th>WhatsApp</Th>
              <Th>Status</Th>
              <Th>Level</Th>
              <Th>Goal</Th>
              <Th>Urgency</Th>
              <Th>Lang</Th>
              <Th>#</Th>
              <Th>Next action</Th>
              <Th>Trial</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-slate-500">No leads match.</td></tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60">
                <Td>
                  <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                    {l.name || "—"}
                  </Link>
                </Td>
                <Td><code className="text-xs">{l.whatsapp_normalized}</code></Td>
                <Td><StatusBadge status={l.status} /></Td>
                <Td>{l.german_level}</Td>
                <Td>{l.goal}</Td>
                <Td>{l.urgency}</Td>
                <Td>{l.language}</Td>
                <Td>{l.current_followup_number}</Td>
                <Td>
                  {l.next_contact_date
                    ? new Date(l.next_contact_date).toLocaleDateString("de-DE")
                    : "—"}
                </Td>
                <Td>
                  {l.trial_scheduled_at
                    ? new Date(l.trial_scheduled_at).toLocaleDateString("de-DE")
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
      {page > 1 && <Link href={qs(page - 1)} className="btn-secondary text-xs">← Prev</Link>}
      <span className="text-slate-600">Page {page} / {totalPages}</span>
      {page < totalPages && <Link href={qs(page + 1)} className="btn-secondary text-xs">Next →</Link>}
    </nav>
  );
}
