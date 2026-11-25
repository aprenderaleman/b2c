"use client";

/**
 * Ajustes del CRM del closer (CRM Closer F4+F7, Gelfis 2026-11-25).
 * Edita system_config sin deploy: documento de bienvenida y copy del
 * WhatsApp de reagenda. Vacío = volver al comportamiento por defecto.
 */

import { useEffect, useState, useTransition } from "react";

type ConfigResponse = {
  ok: boolean;
  values: Record<string, string>;
  defaults: { closer_copy_reagenda: string };
};

export function CloserConfigCard() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [docUrl, setDocUrl] = useState("");
  const [copyReagenda, setCopyReagenda] = useState("");
  const [defaultCopy, setDefaultCopy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/api/admin/closers/config")
      .then((r) => r.json())
      .then((d: ConfigResponse) => {
        setDocUrl(d.values?.closer_welcome_doc_url ?? "");
        setCopyReagenda(d.values?.closer_copy_reagenda ?? "");
        setDefaultCopy(d.defaults?.closer_copy_reagenda ?? "");
        setLoaded(true);
      })
      .catch(() => setMsg({ ok: false, text: "No pude cargar los ajustes." }));
  }, [open, loaded]);

  const save = () => {
    setMsg(null);
    startSaving(async () => {
      const res = await fetch("/api/admin/closers/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closer_welcome_doc_url: docUrl.trim(),
          closer_copy_reagenda: copyReagenda.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      setMsg(res.ok
        ? { ok: true, text: "Guardado. Los cambios aplican en menos de un minuto." }
        : { ok: false, text: body?.message ?? body?.error ?? "Error al guardar" });
    });
  };

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          ⚙️ Ajustes del CRM del closer
        </span>
        <span className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div>
            <label htmlFor="closer-doc-url" className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
              Documento de bienvenida (URL)
            </label>
            <input
              id="closer-doc-url"
              type="url"
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="https://docs.google.com/..."
              className="input-text text-sm"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Se incluye en el email de alta de cada closer nuevo. Vacío = el email sale sin documento.
            </p>
          </div>

          <div>
            <label htmlFor="closer-copy-reagenda" className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
              Copy del WhatsApp de reagenda
            </label>
            <textarea
              id="closer-copy-reagenda"
              value={copyReagenda}
              onChange={(e) => setCopyReagenda(e.target.value)}
              placeholder={defaultCopy || "Cargando..."}
              rows={7}
              className="input-text text-sm font-mono"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Placeholders: <code>{"{nombre}"}</code> (nombre de pila del lead) y <code>{"{enlace}"}</code> (URL de reagenda).
              Vacío = usar el texto por defecto (mostrado como placeholder).
            </p>
          </div>

          {msg && (
            <p className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {msg.text}
            </p>
          )}

          <button onClick={save} disabled={saving || !loaded} className="btn-primary text-sm disabled:opacity-50">
            {saving ? "Guardando..." : "Guardar ajustes"}
          </button>
        </div>
      )}
    </section>
  );
}
