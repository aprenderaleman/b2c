"use client";

/**
 * Modal [Registrar] de la cola HOY (Gelfis 2026-08-03).
 *
 * Capa 1: resultado (contactado/no contestó/buzón/reagendó/venta/no
 * interesado) con chips de objeción y motivos de perdido.
 * Capa 2: "siguiente jugada" — las acciones layer2 con mensaje
 * copiable, embebidas en el mismo modal. Todo inline, sin navegar.
 *
 * Si el lead tiene tarea pendiente completa la tarea; si no, registra
 * la acción directa sobre el lead (/registrar).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layer2Actions } from "./Layer2Actions";

type Props = {
  leadId: string;
  leadName: string;
  /** Tarea a completar; null → registro directo sobre el lead */
  taskId: string | null;
  onClose: () => void;
  onVenta: () => void;
};

type Screen = "resultado" | "contactado" | "no_interesado" | "jugada";

const OBJECTION_CHIPS = [
  { value: "precio", label: "Precio" },
  { value: "pensarlo", label: "Pensarlo" },
  { value: "pareja", label: "Pareja/familia" },
  { value: "tiempo", label: "Tiempo" },
  { value: "otra", label: "Otra" },
] as const;

const MOTIVOS_NO_INTERESADO = [
  { value: "Se enfrio", label: "Se enfrió" },
  { value: "Sin dinero", label: "Sin dinero" },
  { value: "Eligio otra academia", label: "Eligió otra" },
  { value: "Otro", label: "Otro" },
] as const;

export function RegistrarModal({ leadId, leadName, taskId, onClose, onVenta }: Props) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("resultado");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [objectionChip, setObjectionChip] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState("");

  const submit = (
    resultado: string,
    extras?: { objectionChip?: string; motivoNoInteresado?: string },
  ) => {
    setError(null);
    startTransition(async () => {
      const url = taskId
        ? `/api/closer/tasks/${taskId}/complete`
        : `/api/closer/leads/${leadId}/registrar`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resultado,
          notas: nota || undefined,
          objectionChip: extras?.objectionChip,
          motivoNoInteresado: extras?.motivoNoInteresado,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Error al registrar");
        return;
      }

      if (resultado === "no_interesado") {
        // Perdido: la card sale de la cola
        router.refresh();
        onClose();
        return;
      }

      // Capa 2: siguiente jugada
      setNota("");
      setScreen("jugada");
      router.refresh();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        {/* Header */}
        <header className="sticky top-0 bg-white dark:bg-slate-900 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {screen === "resultado" && "¿Qué pasó?"}
              {screen === "contactado" && "Objeción"}
              {screen === "no_interesado" && "Motivo"}
              {screen === "jugada" && "Siguiente jugada"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{leadName}</p>
          </div>
          {(screen === "contactado" || screen === "no_interesado") && (
            <button
              onClick={() => { setScreen("resultado"); setObjectionChip(null); setMotivo(null); }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              &larr; Atrás
            </button>
          )}
        </header>

        <div className="p-5">
          {screen === "resultado" && (
            <div className="grid grid-cols-2 gap-2">
              <ResultBtn label="Contactado" icon="✓" cls="bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" onClick={() => setScreen("contactado")} disabled={pending} />
              <ResultBtn label="No contestó" icon="✗" cls="bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30" onClick={() => submit("no_contesto")} disabled={pending} />
              <ResultBtn label="Buzón" icon="🎙" cls="bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30" onClick={() => submit("buzon")} disabled={pending} />
              <ResultBtn label="Reagendó" icon="📅" cls="bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30" onClick={() => submit("reagendado")} disabled={pending} />
              <ResultBtn label="VENTA" icon="💰" cls="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 col-span-2" onClick={() => { onClose(); onVenta(); }} disabled={pending} />
              <ResultBtn label="No interesado" icon="—" cls="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30 col-span-2" onClick={() => setScreen("no_interesado")} disabled={pending} />
            </div>
          )}

          {screen === "contactado" && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                  Objeción (opcional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {OBJECTION_CHIPS.map((chip) => (
                    <Chip
                      key={chip.value}
                      label={chip.label}
                      active={objectionChip === chip.value}
                      activeCls="bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-500/40"
                      onClick={() => setObjectionChip(objectionChip === chip.value ? null : chip.value)}
                    />
                  ))}
                </div>
              </div>
              <NotaField nota={nota} setNota={setNota} placeholder="Detalle de la conversación..." />
              <button
                onClick={() => submit("contactado", { objectionChip: objectionChip ?? undefined })}
                disabled={pending}
                className="w-full btn-primary"
              >
                {pending ? "Guardando..." : "Guardar"}
              </button>
            </div>
          )}

          {screen === "no_interesado" && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                  Motivo
                </p>
                <div className="flex flex-wrap gap-2">
                  {MOTIVOS_NO_INTERESADO.map((m) => (
                    <Chip
                      key={m.value}
                      label={m.label}
                      active={motivo === m.value}
                      activeCls="bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-500/40"
                      onClick={() => setMotivo(motivo === m.value ? null : m.value)}
                    />
                  ))}
                </div>
              </div>
              <NotaField nota={nota} setNota={setNota} placeholder="Detalle..." />
              <button
                onClick={() => submit("no_interesado", { motivoNoInteresado: motivo ?? undefined })}
                disabled={pending || !motivo}
                className="w-full btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Guardando..." : "Confirmar perdido"}
              </button>
            </div>
          )}

          {screen === "jugada" && (
            <div className="space-y-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl px-3 py-2">
                ✓ Registrado. ¿Cuál es la siguiente jugada?
              </p>
              <Layer2Actions
                leadId={leadId}
                leadName={leadName}
                onOpenSendOffer={() => { onClose(); onVenta(); }}
              />
              <button
                onClick={() => { router.refresh(); onClose(); }}
                className="w-full text-center text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Listo
              </button>
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {screen !== "jugada" && (
          <footer className="px-5 py-3 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={onClose}
              className="w-full text-center text-sm text-slate-500 dark:text-slate-400 py-1"
            >
              Cancelar
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function ResultBtn({ label, icon, cls, onClick, disabled }: {
  label: string; icon: string; cls: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-2xl border p-4 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      <span className="w-8 h-8 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center text-sm flex-shrink-0">
        {icon}
      </span>
      {label}
    </button>
  );
}

function Chip({ label, active, activeCls, onClick }: {
  label: string; active: boolean; activeCls: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs rounded-full border px-3 py-1.5 font-medium transition-colors ${
        active
          ? activeCls
          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function NotaField({ nota, setNota, placeholder }: {
  nota: string; setNota: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
        Nota (opcional)
      </p>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="input-text text-sm"
      />
    </div>
  );
}
