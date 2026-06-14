"use client";

import { useState, useRef } from "react";

export function AdsUpload() {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ inserted: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setStatus("uploading");
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/admin/empresa/ads-csv", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setResult({ inserted: 0, errors: [data.error ?? "Error desconocido"] });
        return;
      }
      setStatus("done");
      setResult({ inserted: data.inserted, errors: data.errors ?? [] });
    } catch {
      setStatus("error");
      setResult({ inserted: 0, errors: ["Error de conexion"] });
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-700 dark:file:text-slate-300 file:cursor-pointer"
        />
        <button
          onClick={handleUpload}
          disabled={status === "uploading"}
          className="rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === "uploading" ? "Subiendo..." : "Importar"}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        CSV de Google Ads con columnas: Day, Campaign, Cost, Clicks, Impressions, Conversions
      </p>
      {status === "done" && result && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          {result.inserted} filas importadas.
          {result.errors.length > 0 && ` ${result.errors.length} errores.`}
        </p>
      )}
      {status === "error" && result && (
        <p className="text-xs text-red-600 dark:text-red-400">{result.errors[0]}</p>
      )}
    </div>
  );
}
