"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AddNoteInput({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const handleSubmit = () => {
    if (note.trim().length < 3) return;
    setError(null);
    startSaving(async () => {
      const res = await fetch(`/api/teacher/leads/${leadId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note.trim() }),
      });
      if (!res.ok) {
        setError("No se pudo guardar la nota. Inténtalo de nuevo.");
        return;
      }
      setNote("");
      router.refresh();
    });
  };

  return (
    <div>
      <div className="flex gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Escribe una nota sobre este lead..."
          rows={2}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={note.trim().length < 3 || saving}
          className="self-end rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {saving ? "..." : "Guardar"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
        Ctrl+Enter para guardar · la nota la ven también el admin y el closer
      </p>
    </div>
  );
}
