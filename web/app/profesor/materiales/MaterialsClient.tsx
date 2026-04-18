"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Material = {
  id:              string;
  title:           string;
  description:     string | null;
  file_url:        string;
  file_name:       string;
  file_type:       string;
  file_size_bytes: number | null;
  tags:            string[];
  visibility:      "private" | "shared";
  created_at:      string;
};

export function MaterialsClient({
  initialMaterials, tagCounts, currentQ, currentTag,
}: {
  initialMaterials: Material[];
  tagCounts:        Record<string, number>;
  currentQ:         string;
  currentTag:       string;
}) {
  const router = useRouter();
  const [q,       setQ]    = useState(currentQ);
  const [pending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);

  const applyFilter = () => {
    const params = new URLSearchParams();
    if (q)          params.set("q", q);
    if (currentTag) params.set("tag", currentTag);
    startTransition(() => router.push(`/profesor/materiales?${params.toString()}`));
  };

  const clearTag = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    startTransition(() => router.push(`/profesor/materiales?${params.toString()}`));
  };

  return (
    <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <aside className="space-y-3">
        <form
          onSubmit={(e) => { e.preventDefault(); applyFilter(); }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="input-text"
          />
        </form>

        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="btn-primary w-full text-sm"
        >
          + Subir material
        </button>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1">
            Tags
          </h3>
          {Object.keys(tagCounts).length === 0 ? (
            <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">
              Sin tags todavía.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {currentTag && (
                <li>
                  <button
                    type="button"
                    onClick={clearTag}
                    className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    ← Todos
                  </button>
                </li>
              )}
              {Object.entries(tagCounts).sort().map(([tag, n]) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => router.push(`/profesor/materiales?tag=${encodeURIComponent(tag)}${q ? `&q=${encodeURIComponent(q)}` : ""}`)}
                    className={`text-xs rounded-full border px-2.5 py-0.5 transition-colors
                      ${currentTag === tag
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                  >
                    {tag} <span className="text-slate-400">({n})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <div>
        {initialMaterials.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-8 text-center">
            <div className="text-4xl" aria-hidden>📚</div>
            <p className="mt-3 text-slate-600 dark:text-slate-300 font-medium">
              Sin materiales todavía.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Sube PDFs de ejercicios, audios o imágenes para reutilizarlos.
            </p>
          </section>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {initialMaterials.map(m => (
              <MaterialCard key={m.id} material={m} />
            ))}
          </ul>
        )}
      </div>

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); router.refresh(); }}
        />
      )}

      {pending && <div className="fixed top-4 right-4 text-xs text-slate-500">Cargando…</div>}
    </div>
  );
}

function MaterialCard({ material }: { material: Material }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    if (!confirm(`¿Eliminar "${material.title}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/teacher/materials/${material.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else alert("No se pudo eliminar.");
    setDeleting(false);
  };
  return (
    <li className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{material.title}</h4>
          {material.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{material.description}</p>
          )}
        </div>
        <a
          href={material.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand-600 dark:text-brand-400 hover:underline shrink-0"
        >
          Abrir →
        </a>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {material.tags.map(t => (
          <span key={t} className="text-[10px] rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-600 dark:text-slate-300">
            {t}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
        <span>{formatBytes(material.file_size_bytes)} · {material.file_type.split("/")[1] ?? material.file_type}</span>
        <button
          type="button"
          onClick={del}
          disabled={deleting}
          className="text-red-600 dark:text-red-400 hover:underline"
        >
          Eliminar
        </button>
      </div>
    </li>
  );
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [tags,        setTags]        = useState("");
  const [pending,     startTransition] = useTransition();
  const [error,       setError]       = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file)             { setError("Elige un archivo.");  return; }
    if (!title.trim())     { setError("Ponle un título.");   return; }
    if (file.size > 50 * 1024 * 1024) { setError("Archivo > 50 MB."); return; }

    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title.trim());
      form.append("description", description.trim());
      form.append("tags", tags.trim());
      form.append("visibility", "private");
      const res = await fetch("/api/teacher/materials", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al subir.");
        return;
      }
      onUploaded();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Subir material</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Hasta 50 MB por archivo.</p>
        </header>
        <div className="p-6 space-y-4">
          <input type="file" ref={fileRef} className="block w-full text-sm text-slate-600 dark:text-slate-300" />
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-text mt-1" maxLength={200} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Descripción (opcional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-text mt-1" rows={2} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Tags (separados por coma)</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="input-text mt-1" placeholder="p.ej. A1, vocabulario, viajes" />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
            {pending ? "Subiendo…" : "Subir"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatBytes(b: number | null): string {
  if (b === null || b === undefined) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
