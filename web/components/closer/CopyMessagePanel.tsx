"use client";

import { useState } from "react";

type Props = {
  message: string;
  actionLabel: string;
  onSent: () => void;
  onClose: () => void;
  pending?: boolean;
};

export function CopyMessagePanel({ message, actionLabel, onSent, onClose, pending }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {actionLabel}
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          Cerrar
        </button>
      </header>

      <div className="p-5 space-y-4">
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
          {message}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className={`flex-1 text-sm font-medium rounded-2xl border px-4 py-2.5 transition-colors ${
              copied
                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            {copied ? "Copiado!" : "Copiar"}
          </button>
          <button
            onClick={onSent}
            disabled={pending}
            className="flex-1 text-sm font-medium rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-4 py-2.5 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {pending ? "Registrando..." : "Enviado"}
          </button>
        </div>
      </div>
    </div>
  );
}
