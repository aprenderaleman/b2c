"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useEffect } from "react";

type Closer = {
  id: string;
  full_name: string | null;
  email: string;
  flujo_activo?: boolean;
};

type Props = {
  leadId: string;
  onClose: () => void;
};

export function AssignCloserModal({ leadId, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [closerId, setCloserId] = useState("");
  const [tipo, setTipo] = useState<"tipo_a" | "tipo_b">("tipo_a");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/closers")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.closers ?? []) as Closer[];
        setClosers(list);
        if (list.length > 0) setCloserId(list[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const submit = () => {
    if (!closerId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/leads/${leadId}/assign-closer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closerId, tipo }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al asignar closer");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Asignar closer
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Se generaran tareas automaticas segun la cadencia seleccionada.
          </p>
        </header>

        <div className="p-6 space-y-4">
          {loading ? (
            <p className="text-sm text-slate-400">Cargando closers...</p>
          ) : closers.length === 0 ? (
            <p className="text-sm text-slate-500">No hay closers disponibles. Crea uno primero.</p>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Closer</span>
                <select
                  value={closerId}
                  onChange={(e) => setCloserId(e.target.value)}
                  className="input-text mt-1"
                >
                  {closers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name ?? c.email}{c.flujo_activo === false ? " (PAUSADO)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Tipo de cadencia</span>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as "tipo_a" | "tipo_b")}
                  className="input-text mt-1"
                >
                  <option value="tipo_a">Tipo A — Asistio a trial (5 pasos, 30 dias)</option>
                  <option value="tipo_b">Tipo B — No asistio (4 pasos, 12 dias)</option>
                </select>
              </label>
            </>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={submit}
            disabled={pending || !closerId || closers.length === 0}
            className="btn-primary"
          >
            {pending ? "Asignando..." : "Asignar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
