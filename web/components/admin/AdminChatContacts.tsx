"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Contact = { userId: string; name: string; email: string; phone: string | null; active: boolean; subtitle: string };
type Tab = "profes" | "alumnos";

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const digits = (t: string) => t.replace(/\D/g, "");

/**
 * Listas de contactos (profes / estudiantes) con buscador por nombre,
 * apellido, correo y teléfono. Al pulsar un contacto se abre (o crea) el
 * chat directo con el admin y se selecciona en el ChatShell de abajo.
 */
export function AdminChatContacts() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("alumnos");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ profes: Contact[]; alumnos: Contact[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    fetch("/api/admin/chat/contacts").then(r => r.json()).then(setData).catch(() => setData({ profes: [], alumnos: [] }));
  }, []);

  const list = useMemo(() => {
    const src = data?.[tab] ?? [];
    const qn = norm(q.trim()); const qd = digits(q);
    return src.filter(c => {
      if (!showInactive && !c.active) return false;
      if (!qn) return true;
      return norm(c.name).includes(qn) || norm(c.email).includes(qn) || (qd.length >= 3 && !!c.phone && digits(c.phone).includes(qd));
    });
  }, [data, tab, q, showInactive]);

  const open = async (c: Contact) => {
    setOpening(c.userId);
    try {
      const res = await fetch("/api/admin/chat/direct", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: c.userId }) });
      const j = await res.json();
      if (j.chatId) router.push(`/admin/chats?chat=${j.chatId}`);
    } finally { setOpening(null); }
  };

  const counts = { profes: data?.profes.filter(c => c.active).length ?? 0, alumnos: data?.alumnos.filter(c => c.active).length ?? 0 };

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-sm">
          {(["alumnos", "profes"] as Tab[]).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md ${tab === t ? "bg-white dark:bg-slate-900 shadow text-slate-900 dark:text-slate-50 font-medium" : "text-slate-600 dark:text-slate-300"}`}>
              {t === "alumnos" ? `Estudiantes (${counts.alumnos})` : `Profes (${counts.profes})`}
            </button>
          ))}
        </div>
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre, apellido, correo o teléfono…"
          aria-label="Buscar contacto"
          className="flex-1 min-w-[220px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded border-slate-300 dark:border-slate-700" />
          Incluir inactivos
        </label>
      </div>
      <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
        {!data && <li className="p-4 text-sm text-slate-500">Cargando contactos…</li>}
        {data && list.length === 0 && <li className="p-4 text-sm text-slate-500 dark:text-slate-400">Sin resultados{q ? ` para “${q}”` : ""}.</li>}
        {list.map(c => (
          <li key={c.userId}>
            <button type="button" onClick={() => open(c)} disabled={opening === c.userId}
              className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-60">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {c.name}{!c.active && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">inactivo</span>}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {c.subtitle} · {c.email}{c.phone ? ` · ${c.phone}` : ""}
                </div>
              </div>
              <span className="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400">{opening === c.userId ? "Abriendo…" : "Abrir chat →"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
