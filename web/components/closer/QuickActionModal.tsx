"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  taskId: string;
  leadName: string;
  onClose: () => void;
  onVenta: () => void;
};

type Screen = "main" | "contactado" | "no_interesado";

const OBJECTION_CHIPS = [
  { value: "precio", label: "Precio" },
  { value: "pensarlo", label: "Pensarlo" },
  { value: "pareja", label: "Pareja/familia" },
  { value: "tiempo", label: "Tiempo" },
  { value: "otra", label: "Otra" },
] as const;

const MOTIVOS_NO_INTERESADO = [
  { value: "Se enfrio", label: "Se enfrio" },
  { value: "Sin dinero", label: "Sin dinero" },
  { value: "Eligio otra academia", label: "Eligio otra" },
  { value: "Otro", label: "Otro" },
] as const;

export function QuickActionModal({ taskId, leadName, onClose, onVenta }: Props) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("main");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [objectionChip, setObjectionChip] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState("");

  const submit = (resultado: string, extras?: { objectionChip?: string; motivoNoInteresado?: string }) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/closer/tasks/${taskId}/complete`, {
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
        setError(body?.error ?? "Error al completar");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  const handleSimple = (resultado: string) => {
    submit(resultado);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        {/* Header */}
        <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {screen === "main" ? "Resultado" : screen === "contactado" ? "Objecion" : "Motivo"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{leadName}</p>
          </div>
          {screen !== "main" && (
            <button
              onClick={() => { setScreen("main"); setObjectionChip(null); setMotivo(null); setNota(""); }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              &larr; Atras
            </button>
          )}
        </header>

        <div className="p-5">
          {screen === "main" && (
            <MainScreen
              pending={pending}
              onContactado={() => setScreen("contactado")}
              onNoContesto={() => handleSimple("no_contesto")}
              onBuzon={() => handleSimple("buzon")}
              onReagendado={() => handleSimple("reagendado")}
              onVenta={() => { onClose(); onVenta(); }}
              onNoInteresado={() => setScreen("no_interesado")}
            />
          )}

          {screen === "contactado" && (
            <ContactadoScreen
              pending={pending}
              objectionChip={objectionChip}
              setObjectionChip={setObjectionChip}
              nota={nota}
              setNota={setNota}
              onSubmit={() => submit("contactado", { objectionChip: objectionChip ?? undefined })}
            />
          )}

          {screen === "no_interesado" && (
            <NoInteresadoScreen
              pending={pending}
              motivo={motivo}
              setMotivo={setMotivo}
              nota={nota}
              setNota={setNota}
              onSubmit={() => submit("no_interesado", { motivoNoInteresado: motivo ?? undefined })}
            />
          )}
        </div>

        {error && (
          <p className="px-5 pb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <footer className="px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="w-full text-center text-sm text-slate-500 dark:text-slate-400 py-1"
          >
            Cancelar
          </button>
        </footer>
      </div>
    </div>
  );
}

function MainScreen({
  pending,
  onContactado,
  onNoContesto,
  onBuzon,
  onReagendado,
  onVenta,
  onNoInteresado,
}: {
  pending: boolean;
  onContactado: () => void;
  onNoContesto: () => void;
  onBuzon: () => void;
  onReagendado: () => void;
  onVenta: () => void;
  onNoInteresado: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ResultButton
        label="Contactado"
        icon="C"
        cls="bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30 hover:bg-blue-100 dark:hover:bg-blue-500/20"
        onClick={onContactado}
        disabled={pending}
      />
      <ResultButton
        label="No contesto"
        icon="X"
        cls="bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30 hover:bg-slate-100 dark:hover:bg-slate-500/20"
        onClick={onNoContesto}
        disabled={pending}
      />
      <ResultButton
        label="Buzon"
        icon="B"
        cls="bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30 hover:bg-slate-100 dark:hover:bg-slate-500/20"
        onClick={onBuzon}
        disabled={pending}
      />
      <ResultButton
        label="Reagendo"
        icon="R"
        cls="bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30 hover:bg-purple-100 dark:hover:bg-purple-500/20"
        onClick={onReagendado}
        disabled={pending}
      />
      <ResultButton
        label="VENTA"
        icon="$"
        cls="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 col-span-2"
        onClick={onVenta}
        disabled={pending}
      />
      <ResultButton
        label="No interesado"
        icon="—"
        cls="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30 hover:bg-red-100 dark:hover:bg-red-500/20 col-span-2"
        onClick={onNoInteresado}
        disabled={pending}
      />
    </div>
  );
}

function ResultButton({
  label,
  icon,
  cls,
  onClick,
  disabled,
}: {
  label: string;
  icon: string;
  cls: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-2xl border p-4 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      <span className="w-8 h-8 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center text-sm font-bold flex-shrink-0">
        {icon}
      </span>
      {label}
    </button>
  );
}

function ContactadoScreen({
  pending,
  objectionChip,
  setObjectionChip,
  nota,
  setNota,
  onSubmit,
}: {
  pending: boolean;
  objectionChip: string | null;
  setObjectionChip: (v: string | null) => void;
  nota: string;
  setNota: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
          Objecion (opcional)
        </p>
        <div className="flex flex-wrap gap-2">
          {OBJECTION_CHIPS.map((chip) => (
            <button
              key={chip.value}
              onClick={() => setObjectionChip(objectionChip === chip.value ? null : chip.value)}
              className={`text-xs rounded-full border px-3 py-1.5 font-medium transition-colors ${
                objectionChip === chip.value
                  ? "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-500/40"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
          Nota (opcional)
        </p>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Detalle de la conversacion..."
          rows={2}
          className="input-text text-sm"
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={pending}
        className="w-full btn-primary"
      >
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}

function NoInteresadoScreen({
  pending,
  motivo,
  setMotivo,
  nota,
  setNota,
  onSubmit,
}: {
  pending: boolean;
  motivo: string | null;
  setMotivo: (v: string | null) => void;
  nota: string;
  setNota: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
          Motivo
        </p>
        <div className="flex flex-wrap gap-2">
          {MOTIVOS_NO_INTERESADO.map((m) => (
            <button
              key={m.value}
              onClick={() => setMotivo(motivo === m.value ? null : m.value)}
              className={`text-xs rounded-full border px-3 py-1.5 font-medium transition-colors ${
                motivo === m.value
                  ? "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-500/40"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
          Nota (opcional)
        </p>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Detalle..."
          rows={2}
          className="input-text text-sm"
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={pending || !motivo}
        className="w-full btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50"
      >
        {pending ? "Guardando..." : "Confirmar perdido"}
      </button>
    </div>
  );
}
