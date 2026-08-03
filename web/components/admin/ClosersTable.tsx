"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Closer = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  active: boolean;
  rango: string | null;
  flujo_activo: boolean;
  created_at: string;
};

type Props = {
  closers: Closer[];
  leadCounts: Record<string, number>;
};

export function ClosersTable({ closers, leadCounts }: Props) {
  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rango</th>
              <th className="px-4 py-3 font-medium text-right">Leads</th>
              <th className="px-4 py-3 font-medium">Flujo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {closers.map((c) => (
              <CloserRow key={c.id} closer={c} leadCount={leadCounts[c.id] ?? 0} />
            ))}
            {closers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                  No hay closers. Crea el primero.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CloserRow({ closer, leadCount }: { closer: Closer; leadCount: number }) {
  const router = useRouter();
  const [flujo, setFlujo] = useState(closer.flujo_activo);
  const [pending, startTransition] = useTransition();

  const toggleFlujo = () => {
    startTransition(async () => {
      const res = await fetch(`/api/admin/closers/${closer.id}/toggle-flujo`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setFlujo(data.flujo_activo);
        router.refresh();
      }
    });
  };

  return (
    <tr className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
      <td className="px-4 py-3">
        <Link
          href={`/admin/closers/${closer.id}`}
          className="font-medium text-slate-800 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
        >
          {closer.full_name ?? closer.email}
        </Link>
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{closer.email}</td>
      <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-300">
        {closer.rango ?? "rookie"}
      </td>
      <td className="px-4 py-3 text-right">{leadCount}</td>
      <td className="px-4 py-3">
        <button
          onClick={toggleFlujo}
          disabled={pending}
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-colors ${
            flujo
              ? "bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-500/30 hover:bg-brand-100 dark:hover:bg-brand-500/20"
              : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20"
          }`}
        >
          {pending ? "..." : flujo ? "ACTIVO" : "PAUSADO"}
        </button>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          closer.active
            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
            : "bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30"
        }`}>
          {closer.active ? "Activo" : "Inactivo"}
        </span>
      </td>
    </tr>
  );
}
