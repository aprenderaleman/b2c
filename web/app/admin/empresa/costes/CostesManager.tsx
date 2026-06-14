"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { CosteFijo } from "@/lib/empresa";

const CATEGORIES = [
  { value: "hosting",       label: "Hosting" },
  { value: "herramientas",  label: "Herramientas" },
  { value: "profesores",    label: "Profesores" },
  { value: "ads",           label: "Publicidad" },
  { value: "otros",         label: "Otros" },
];

function categoryLabel(cat: string): string {
  return CATEGORIES.find(c => c.value === cat)?.label ?? cat;
}

function moneyFromCents(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

export function CostesManager({ initialCostes }: { initialCostes: CosteFijo[] }) {
  const router = useRouter();
  const [costes, setCostes] = useState(initialCostes);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("herramientas");
  const [amountEur, setAmountEur] = useState("");
  const [notes, setNotes] = useState("");

  const handleAdd = useCallback(async () => {
    const cents = Math.round(parseFloat(amountEur) * 100);
    if (!name.trim() || isNaN(cents) || cents <= 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/admin/empresa/costes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          amount_cents: cents,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        setName("");
        setAmountEur("");
        setNotes("");
        setShowForm(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }, [name, category, amountEur, notes, router]);

  const toggleActive = useCallback(async (id: string, active: boolean) => {
    setCostes(prev => prev.map(c => c.id === id ? { ...c, active } : c));
    await fetch(`/api/admin/empresa/costes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    router.refresh();
  }, [router]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Eliminar este coste fijo?")) return;
    setCostes(prev => prev.filter(c => c.id !== id));
    await fetch(`/api/admin/empresa/costes/${id}`, { method: "DELETE" });
    router.refresh();
  }, [router]);

  return (
    <div className="space-y-4">
      {/* Add form */}
      {showForm ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Vercel Pro"
                className="input-text w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Categoria</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="input-text w-full"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Monto mensual (EUR)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountEur}
                onChange={e => setAmountEur(e.target.value)}
                placeholder="29.00"
                className="input-text w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Notas (opcional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="input-text w-full"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Agregar"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          + Agregar coste fijo
        </button>
      )}

      {/* Table */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {costes.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No hay costes fijos registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Monto/mes</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Notas</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {costes.map(c => (
                  <tr
                    key={c.id}
                    className={c.active ? "" : "opacity-50"}
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                      {c.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {categoryLabel(c.category)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono">
                      {moneyFromCents(c.amount_cents)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => toggleActive(c.id, !c.active)}
                        className={`text-xs font-medium px-2 py-1 rounded ${
                          c.active
                            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {c.active ? "Activo" : "Inactivo"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                      {c.notes ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
