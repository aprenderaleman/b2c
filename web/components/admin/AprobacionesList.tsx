"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConvertLeadModal } from "./ConvertLeadModal";

type Venta = {
  id: string;
  lead_id: string;
  rol_solicitante: string;
  pack_id: string | null;
  payment_type: string | null;
  monto_cents: number | null;
  moneda: string;
  estado: string;
  motivo_rechazo?: string | null;
  created_at: string;
  aprobado_at?: string | null;
  leads: { full_name: string | null; email?: string; whatsapp_normalized?: string };
  users?: { full_name: string | null };
};

type Props = {
  pendientes: Venta[];
  recientes: Venta[];
};

export function AprobacionesList({ pendientes, recientes }: Props) {
  const router = useRouter();
  const [convertingVenta, setConvertingVenta] = useState<Venta | null>(null);
  const [rejectingVenta, setRejectingVenta] = useState<Venta | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleReject = () => {
    if (!rejectingVenta || !motivo.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/ventas/${rejectingVenta.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      if (!res.ok) {
        setError("Error al rechazar");
        return;
      }
      setRejectingVenta(null);
      setMotivo("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Pendientes */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Pendientes ({pendientes.length})
        </h2>
        {pendientes.length === 0 ? (
          <p className="text-sm text-slate-400">No hay ventas pendientes.</p>
        ) : (
          <div className="space-y-3">
            {pendientes.map((v) => (
              <div
                key={v.id}
                className="p-4 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 flex items-center gap-4 flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                    {v.leads.full_name ?? "Lead"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Pack: {v.pack_id ?? "?"} · {v.payment_type ?? "?"} ·{" "}
                    {v.monto_cents ? `${(v.monto_cents / 100).toLocaleString("es")} ${v.moneda}` : "?"} ·{" "}
                    por {v.users?.full_name ?? v.rol_solicitante}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(v.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConvertingVenta(v)}
                    className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1"
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => setRejectingVenta(v)}
                    className="text-xs font-medium rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-1"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recientes */}
      {recientes.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Historial reciente
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Pack</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {recientes.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{v.leads.full_name}</td>
                    <td className="px-4 py-2">{v.pack_id}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                        v.estado === "aprobada"
                          ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
                          : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30"
                      }`}>
                        {v.estado === "aprobada" ? "Aprobada" : "Rechazada"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs">
                      {v.aprobado_at ? new Date(v.aprobado_at).toLocaleDateString("es", { day: "numeric", month: "short" }) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Approve modal via ConvertLeadModal */}
      {convertingVenta && (
        <ConvertLeadModal
          lead={{
            id: convertingVenta.lead_id,
            name: convertingVenta.leads.full_name ?? "",
            email: convertingVenta.leads.email ?? null,
            phone: convertingVenta.leads.whatsapp_normalized ?? "",
            language: "es",
            german_level: "",
            goal: null,
          }}
          open={true}
          onClose={() => setConvertingVenta(null)}
          convertEndpoint={`/api/admin/ventas/${convertingVenta.id}/approve`}
        />
      )}

      {/* Reject modal */}
      {rejectingVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setRejectingVenta(null); }}>
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Rechazar venta</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {rejectingVenta.leads.full_name} — {rejectingVenta.pack_id}
            </p>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo del rechazo..."
              className="input-text"
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => { setRejectingVenta(null); setMotivo(""); }} className="btn-secondary">Cancelar</button>
              <button onClick={handleReject} disabled={!motivo.trim() || pending} className="btn-primary bg-red-600 hover:bg-red-700">
                {pending ? "Rechazando..." : "Rechazar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
