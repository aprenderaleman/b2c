"use client";

/**
 * Vista HOY — cola de trabajo única del closer (Gelfis 2026-08-03).
 *
 * UNA lista ordenada por semáforo (🔴 → 🟡 → 🟢; dentro de cada color
 * 💰 → 🔥 → antigüedad). Cada card muestra POR QUÉ está ahí y se
 * registra todo inline con [Registrar], sin navegar. La lista vacía
 * de rojos/amarillos es el "día terminado".
 */

import { useState } from "react";
import Link from "next/link";
import type { QueueItem, SemaforoColor } from "@/lib/closer-semaforo";
import { RegistrarModal } from "./RegistrarModal";
import { MarkSaleModal } from "./MarkSaleModal";

type Props = {
  items: QueueItem[];
};

const DOT: Record<SemaforoColor, string> = {
  rojo: "bg-red-500",
  amarillo: "bg-amber-400",
  verde: "bg-emerald-500",
};

const CARD_BORDER: Record<SemaforoColor, string> = {
  rojo: "border-l-red-500",
  amarillo: "border-l-amber-400",
  verde: "border-l-emerald-500",
};

const REASON_CLS: Record<SemaforoColor, string> = {
  rojo: "text-red-700 dark:text-red-300",
  amarillo: "text-amber-700 dark:text-amber-300",
  verde: "text-slate-500 dark:text-slate-400",
};

export function CloserQueue({ items }: Props) {
  const [registrar, setRegistrar] = useState<QueueItem | null>(null);
  const [saleLeadId, setSaleLeadId] = useState<string | null>(null);
  const [verVerdes, setVerVerdes] = useState(false);

  const activos = items.filter((i) => i.color !== "verde");
  const verdes = items.filter((i) => i.color === "verde");
  const rojos = activos.filter((i) => i.color === "rojo").length;
  const amarillos = activos.filter((i) => i.color === "amarillo").length;
  const alDia = rojos === 0 && amarillos === 0;
  const visibles = verVerdes ? items : activos;

  return (
    <div className="space-y-4">
      {/* Cabecera con contador */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Hoy</h1>
        <div className="flex items-center gap-3 text-sm font-semibold">
          {rojos > 0 && <span className="text-red-600 dark:text-red-400">🔴 {rojos}</span>}
          {amarillos > 0 && <span className="text-amber-600 dark:text-amber-400">🟡 {amarillos}</span>}
          {alDia && <span className="text-emerald-600 dark:text-emerald-400">✅ al día</span>}
        </div>
      </div>

      {/* Cola única — verdes colapsados en "✅ Al día (N)" */}
      <div className="space-y-2">
        {visibles.map((item) => (
          <div
            key={item.leadId}
            className={`rounded-2xl border border-slate-200 dark:border-slate-800 border-l-4 ${CARD_BORDER[item.color]} bg-white dark:bg-slate-900 p-4`}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[item.color]}`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-slate-900 dark:text-slate-50">
                    {item.leadName}
                  </span>
                  {item.vip && (
                    <span className="text-[10px] font-extrabold uppercase rounded-full border px-1.5 py-0.5 bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-900 border-amber-300" title="Reserva prioritaria pagada">
                      💰 VIP
                    </span>
                  )}
                  {item.urgente && (
                    <span className="text-[10px] font-bold uppercase rounded-full border px-1.5 py-0.5 bg-red-50 text-red-700 border-red-200" title="Fecha concreta (examen/trámite)">
                      🔥
                    </span>
                  )}
                  {item.paidIntent && (
                    <span className="text-[10px] font-bold uppercase rounded-full border px-1.5 py-0.5 bg-slate-100 text-slate-700 border-slate-300" title="Empezó el pago del depósito sin completarlo">
                      💎
                    </span>
                  )}
                  {item.estadoCierre === "seguimiento_pactado" && (
                    <span className="text-[10px] font-medium rounded-full border px-1.5 py-0.5 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30">
                      📅 pactado
                    </span>
                  )}
                  {item.estadoCierre === "en_reactivacion" && (
                    <span className="text-[10px] font-medium rounded-full border px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30">
                      🌙 reactivación
                    </span>
                  )}
                </div>
                {/* Por qué está aquí — badge tipado + detalle */}
                <p className={`text-[12.5px] mt-0.5 ${REASON_CLS[item.color]}`}>
                  {item.color === "rojo" && (
                    <span className="font-bold mr-1.5">{item.badge}</span>
                  )}
                  {item.reason}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {item.leadPhone && (
                  <a
                    href={`https://wa.me/${item.leadPhone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                    title="Abrir WhatsApp"
                  >
                    WA
                  </a>
                )}
                <button
                  onClick={() => setRegistrar(item)}
                  className="text-xs font-semibold rounded-full bg-brand-600 hover:bg-brand-700 text-white px-3.5 py-1.5 transition-colors"
                >
                  Registrar
                </button>
                <Link
                  href={`/closer/leads/${item.leadId}`}
                  className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Ficha
                </Link>
              </div>
            </div>
          </div>
        ))}

        {verdes.length > 0 && (
          <button
            type="button"
            onClick={() => setVerVerdes(!verVerdes)}
            className="w-full rounded-2xl border border-dashed border-emerald-200 dark:border-emerald-500/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/5 transition-colors text-left"
          >
            ✅ Al día ({verdes.length}) {verVerdes ? "— ocultar" : "— ver"}
          </button>
        )}

        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center">
            <p className="text-2xl mb-1">✅</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sin leads en la cola. ¡Al día!
            </p>
          </div>
        )}
      </div>

      {/* Modales */}
      {registrar && (
        <RegistrarModal
          leadId={registrar.leadId}
          leadName={registrar.leadName}
          taskId={registrar.nextTask?.id ?? null}
          onClose={() => setRegistrar(null)}
          onVenta={() => {
            setSaleLeadId(registrar.leadId);
            setRegistrar(null);
          }}
        />
      )}

      {saleLeadId && (
        <MarkSaleModal leadId={saleLeadId} onClose={() => setSaleLeadId(null)} />
      )}
    </div>
  );
}
