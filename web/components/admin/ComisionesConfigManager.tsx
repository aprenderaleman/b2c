"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Row = {
  id: number;
  clave: string;
  valor: number;
  descripcion: string | null;
};

export function ComisionesConfigManager({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const update = (id: number, valor: number) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, valor } : r)));
    setSaved(false);
  };

  const save = () => {
    startTransition(async () => {
      await fetch("/api/admin/config/comisiones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      setSaved(true);
      router.refresh();
    });
  };

  const LABELS: Record<string, string> = {
    bonus_rescate_closer: "Bonus rescate closer (%)",
    factor_profe_precalificacion: "Factor precalificacion profe (x)",
    pool_maximo: "Pool maximo (%)",
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {LABELS[r.clave] ?? r.clave}
              </p>
              {r.descripcion && (
                <p className="text-xs text-slate-400 dark:text-slate-500">{r.descripcion}</p>
              )}
            </div>
            <input
              type="number"
              step="0.01"
              value={r.valor}
              onChange={(e) => update(r.id, Number(e.target.value))}
              className="w-24 input-text text-sm py-2 px-3"
            />
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Guardado!</span>}
      </div>
    </div>
  );
}
