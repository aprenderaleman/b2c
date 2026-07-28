"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Row = {
  id: number;
  rol: string;
  rango: string;
  comision_pct: number;
  min_close_rate: number;
  min_conversiones: number;
};

export function RangosManager({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const update = (id: number, field: keyof Row, value: unknown) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setSaved(false);
  };

  const save = () => {
    startTransition(async () => {
      await fetch("/api/admin/config/rangos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      setSaved(true);
      router.refresh();
    });
  };

  const teacherRows = rows.filter((r) => r.rol === "teacher");
  const closerRows = rows.filter((r) => r.rol === "closer");

  return (
    <div className="space-y-6">
      <RangosTable title="Profesores" rows={teacherRows} onUpdate={update} />
      <RangosTable title="Closers" rows={closerRows} onUpdate={update} />

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Guardado!</span>}
      </div>
    </div>
  );
}

function RangosTable({
  title,
  rows,
  onUpdate,
}: {
  title: string;
  rows: Row[];
  onUpdate: (id: number, field: keyof Row, value: unknown) => void;
}) {
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {title}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">Rango</th>
              <th className="px-3 py-2 font-medium">Comision %</th>
              <th className="px-3 py-2 font-medium">Min close rate %</th>
              <th className="px-3 py-2 font-medium">Min conversiones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 capitalize font-medium text-slate-800 dark:text-slate-200">
                  {r.rango}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.5"
                    value={r.comision_pct}
                    onChange={(e) => onUpdate(r.id, "comision_pct", Number(e.target.value))}
                    className="w-20 input-text text-xs py-1 px-2"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="1"
                    value={r.min_close_rate}
                    onChange={(e) => onUpdate(r.id, "min_close_rate", Number(e.target.value))}
                    className="w-20 input-text text-xs py-1 px-2"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={r.min_conversiones}
                    onChange={(e) => onUpdate(r.id, "min_conversiones", Number(e.target.value))}
                    className="w-20 input-text text-xs py-1 px-2"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
