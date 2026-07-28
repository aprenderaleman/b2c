"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Row = {
  id: number;
  tipo: string;
  paso: number;
  dias_offset: number;
  canal: string;
  plantilla: string;
  activo: boolean;
};

export function CadenciaManager({ initialRows }: { initialRows: Row[] }) {
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
      await fetch("/api/admin/config/cadencia", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      setSaved(true);
      router.refresh();
    });
  };

  const tipoA = rows.filter((r) => r.tipo === "tipo_a");
  const tipoB = rows.filter((r) => r.tipo === "tipo_b");

  return (
    <div className="space-y-6">
      <CadenciaTable title="Tipo A — Lead asistio a trial" rows={tipoA} onUpdate={update} />
      <CadenciaTable title="Tipo B — Lead NO asistio" rows={tipoB} onUpdate={update} />

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Guardado!</span>}
      </div>
    </div>
  );
}

function CadenciaTable({
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
              <th className="px-3 py-2 font-medium">Paso</th>
              <th className="px-3 py-2 font-medium">Dias</th>
              <th className="px-3 py-2 font-medium">Canal</th>
              <th className="px-3 py-2 font-medium">Plantilla</th>
              <th className="px-3 py-2 font-medium">Activo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.paso}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={r.dias_offset}
                    onChange={(e) => onUpdate(r.id, "dias_offset", Number(e.target.value))}
                    className="w-16 input-text text-xs py-1 px-2"
                    min={0}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={r.canal}
                    onChange={(e) => onUpdate(r.id, "canal", e.target.value)}
                    className="input-text text-xs py-1 px-2"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="llamada">Llamada</option>
                    <option value="email">Email</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    value={r.plantilla}
                    onChange={(e) => onUpdate(r.id, "plantilla", e.target.value)}
                    className="w-full input-text text-xs py-1 px-2"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onUpdate(r.id, "activo", !r.activo)}
                    className={`text-xs font-medium rounded-full px-3 py-1 border transition-colors ${
                      r.activo
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
                        : "bg-slate-50 dark:bg-slate-500/10 text-slate-500 border-slate-200 dark:border-slate-500/30"
                    }`}
                  >
                    {r.activo ? "Si" : "No"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
