"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RESOURCE_KINDS, RESOURCE_LEVELS,
  type ResourceKind, type ResourceLevel, type TeacherResource,
} from "@/lib/teacher-resources";

type Filters = {
  level: ResourceLevel | null;
  kind:  ResourceKind  | null;
  topic: string;
  q:     string;
};

export function ResourcesClient({
  initialResources, initialFilters, canUpload, myTeacherId, isStaff,
}: {
  initialResources: TeacherResource[];
  initialFilters:   Filters;
  canUpload:        boolean;
  myTeacherId:      string | null;
  isStaff:          boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [showUpload, setShowUpload] = useState(false);
  // OJO: trabajamos directo con initialResources (vienen del server). Cualquier
  // cambio (filtrar, subir, borrar) dispara router.refresh() y Next.js
  // re-renderiza con los datos frescos. El bug anterior era tener un
  // useState local que NUNCA se re-inicializaba al cambiar las URL params.
  const [filters, setFilters]       = useState<Filters>(initialFilters);

  function applyFilters(next: Filters) {
    setFilters(next);
    const p = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.level && next.level !== "XX") p.set("level", next.level); else p.delete("level");
    if (next.kind)  p.set("kind", next.kind);   else p.delete("kind");
    if (next.topic) p.set("topic", next.topic); else p.delete("topic");
    if (next.q)     p.set("q", next.q);          else p.delete("q");
    startTransition(() => {
      router.replace(`/profesor/recursos${p.toString() ? "?" + p.toString() : ""}`);
      // Fuerza re-fetch del Server Component aunque la URL no cambie.
      router.refresh();
    });
  }

  async function openResource(id: string) {
    const r = await fetch(`/api/profesor/recursos/${id}/open`, { method: "GET" });
    const j = await r.json();
    if (!r.ok || !j.url) {
      alert(j.message ?? j.error ?? "No se pudo abrir el recurso");
      return;
    }
    window.open(j.url, "_blank", "noopener,noreferrer");
  }

  async function deleteResource(id: string) {
    if (!confirm("¿Borrar este recurso? Esta acción no se puede deshacer.")) return;
    const r = await fetch(`/api/profesor/recursos/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.message ?? j.error ?? "No se pudo borrar");
      return;
    }
    router.refresh();
  }

  // Agrupar por sección visual:
  //   - "Lecciones"  = kind=pdf (presentaciones para clase)
  //   - "Cuadernos"  = kind=doc (cuadernos para alumnos)
  //   - "Vídeos y enlaces" = video_link + source_link
  const grouped = useMemo(() => {
    const lecciones:    TeacherResource[] = [];
    const cuadernos:    TeacherResource[] = [];
    const enlaces:      TeacherResource[] = [];
    for (const r of initialResources) {
      if (r.kind === "pdf") lecciones.push(r);
      else if (r.kind === "doc") cuadernos.push(r);
      else enlaces.push(r);
    }
    return { lecciones, cuadernos, enlaces };
  }, [initialResources]);

  return (
    <div className="space-y-5">
      {/* Filtros + acción */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <input
              type="search"
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") applyFilters(filters); }}
              placeholder="Buscar por título o descripción…"
              className="input-text w-full"
            />
          </div>
          {canUpload && (
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="btn-primary text-sm"
            >
              + Subir recurso
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">Nivel:</span>
          {RESOURCE_LEVELS.map(l => {
            const isActive = filters.level === l.id || (!filters.level && l.id === "XX");
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => applyFilters({ ...filters, level: l.id === "XX" ? null : l.id })}
                className={`px-2.5 py-1 text-xs rounded-full border transition ${
                  isActive
                    ? "bg-brand-600 border-brand-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">Tipo:</span>
          <button
            type="button"
            onClick={() => applyFilters({ ...filters, kind: null })}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              !filters.kind
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
            }`}
          >
            Todos
          </button>
          {RESOURCE_KINDS.map(k => {
            const isActive = filters.kind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => applyFilters({ ...filters, kind: k.id })}
                className={`px-2.5 py-1 text-xs rounded-full border transition ${
                  isActive
                    ? "bg-brand-600 border-brand-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
                }`}
              >
                <span className="mr-1" aria-hidden>{k.emoji}</span>{k.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={filters.topic}
            onChange={e => setFilters(f => ({ ...f, topic: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") applyFilters(filters); }}
            placeholder="Filtrar por tema (gramática, vocabulario…)"
            className="input-text text-xs w-full sm:w-80"
          />
          <button
            type="button"
            onClick={() => applyFilters(filters)}
            disabled={pending}
            className="btn-secondary text-xs"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={() => applyFilters({ level: null, kind: null, topic: "", q: "" })}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline"
          >
            Limpiar filtros
          </button>
        </div>
      </section>

      {/* Lista en 3 secciones: lecciones (PDF), cuadernos (DOC),
          vídeos/enlaces. Las que no tienen items se ocultan. Si todo
          está vacío, mensaje único. */}
      {initialResources.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
          <div className="text-4xl">📚</div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            No hay recursos que coincidan con los filtros.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.lecciones.length > 0 && (
            <ResourceSection
              title="📄 Lecciones (presentaciones para clase)"
              count={grouped.lecciones.length}
              items={grouped.lecciones}
              tone="lecciones"
              onOpen={openResource}
              onDelete={deleteResource}
              myTeacherId={myTeacherId}
              isStaff={isStaff}
            />
          )}
          {grouped.cuadernos.length > 0 && (
            <ResourceSection
              title="📝 Cuadernos (para alumnos)"
              count={grouped.cuadernos.length}
              items={grouped.cuadernos}
              tone="cuadernos"
              onOpen={openResource}
              onDelete={deleteResource}
              myTeacherId={myTeacherId}
              isStaff={isStaff}
            />
          )}
          {grouped.enlaces.length > 0 && (
            <ResourceSection
              title="🎬 Vídeos y enlaces"
              count={grouped.enlaces.length}
              items={grouped.enlaces}
              tone="enlaces"
              onOpen={openResource}
              onDelete={deleteResource}
              myTeacherId={myTeacherId}
              isStaff={isStaff}
            />
          )}
        </div>
      )}

      {/* Modal subida */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ResourceSection({ title, count, items, tone, onOpen, onDelete, myTeacherId, isStaff }: {
  title: string;
  count: number;
  items: TeacherResource[];
  tone: "lecciones" | "cuadernos" | "enlaces";
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  myTeacherId: string | null;
  isStaff: boolean;
}) {
  const accent =
    tone === "lecciones" ? "text-blue-700 dark:text-blue-300" :
    tone === "cuadernos" ? "text-emerald-700 dark:text-emerald-300" :
                            "text-amber-700 dark:text-amber-300";
  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <h2 className={`text-sm font-bold tracking-tight ${accent}`}>{title}</h2>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          {count}
        </span>
      </header>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(r => (
          <ResourceCard
            key={r.id}
            r={r}
            onOpen={() => onOpen(r.id)}
            onDelete={() => onDelete(r.id)}
            canDelete={isStaff || Boolean(myTeacherId && r.uploaded_by === myTeacherId)}
          />
        ))}
      </ul>
    </section>
  );
}

function ResourceCard({ r, onOpen, onDelete, canDelete }: {
  r: TeacherResource;
  onOpen: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const kindMeta = RESOURCE_KINDS.find(k => k.id === r.kind);
  return (
    <li className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3 hover:border-brand-400 transition">
      <div className="flex items-start gap-3">
        <div className="text-3xl shrink-0" aria-hidden>{kindMeta?.emoji ?? "📎"}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">{r.title}</h3>
          {r.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{r.description}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center text-[10px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${
          r.level === "XX"
            ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            : "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300"
        }`}>{r.level === "XX" ? "Todos los niveles" : r.level}</span>
        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          {r.topic}
        </span>
        {r.tags.slice(0, 3).map(t => (
          <span key={t} className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">
            #{t}
          </span>
        ))}
        {r.student_visible && (
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-medium">
            👀 Alumnos
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1 mt-auto">
        <span className="truncate">
          {r.uploader_name ? `Por ${r.uploader_name.split(/\s+/)[0]}` : "Por equipo academia"}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onOpen} className="btn-primary text-xs px-3 py-1.5">
            Abrir →
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Borrar recurso"
              className="h-7 w-7 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              title="Borrar"
            >
              🗑
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function UploadModal({
  onClose, onUploaded,
}: {
  onClose:    () => void;
  onUploaded: () => void;            // ahora simple — el padre refresca la página
}) {
  const [kind, setKind]               = useState<ResourceKind>("pdf");
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel]             = useState<ResourceLevel>("A1");
  const [topic, setTopic]             = useState("");
  const [tags, setTags]               = useState("");
  const [file, setFile]               = useState<File | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [studentVisible, setStudentVisible] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const isFileKind = kind === "pdf" || kind === "doc";
  const canSubmit =
    title.trim().length >= 2 &&
    topic.trim().length >= 2 &&
    !submitting &&
    (isFileKind ? !!file : /^https?:\/\//i.test(externalUrl));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("title", title.trim());
      fd.set("description", description.trim());
      fd.set("level", level);
      fd.set("topic", topic.trim());
      fd.set("kind", kind);
      fd.set("tags", tags.trim());
      if (isFileKind && file) fd.set("file", file);
      if (!isFileKind) fd.set("external_url", externalUrl.trim());
      fd.set("student_visible", studentVisible ? "true" : "false");

      const r = await fetch("/api/profesor/recursos", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.message ?? j.error ?? "Error subiendo el recurso");
        setSubmitting(false);
        return;
      }
      // Refrescamos la página — el server vuelve a leer la BD y todas
      // las tarjetas se renderizan con los datos definitivos.
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Subir recurso</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {RESOURCE_KINDS.map(k => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition ${
                kind === k.id
                  ? "bg-brand-50 dark:bg-brand-500/20 border-brand-400 text-brand-700 dark:text-brand-300"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
              }`}
            >
              <span className="mr-1" aria-hidden>{k.emoji}</span>{k.label}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          <Field label="Título *">
            <input value={title} onChange={e => setTitle(e.target.value)}
                   className="input-text w-full" maxLength={200} placeholder="P.ej. Lista de verbos irregulares B1" />
          </Field>
          <Field label="Descripción">
            <textarea value={description} onChange={e => setDescription(e.target.value)}
                      className="input-text w-full" rows={2}
                      placeholder="Opcional — para qué sirve, cómo usarlo…" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nivel *">
              <select value={level} onChange={e => setLevel(e.target.value as ResourceLevel)} className="input-text w-full">
                {RESOURCE_LEVELS.map(l => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Tema *">
              <input value={topic} onChange={e => setTopic(e.target.value)}
                     className="input-text w-full" maxLength={80}
                     placeholder="gramática, vocabulario, cultura…" />
            </Field>
          </div>
          <Field label="Tags (separados por coma)">
            <input value={tags} onChange={e => setTags(e.target.value)}
                   className="input-text w-full" placeholder="perfekt, akkusativ, examen" />
          </Field>

          {isFileKind ? (
            <Field label="Archivo *">
              <input
                type="file"
                accept={kind === "pdf" ? ".pdf,application/pdf" : ".doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"}
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              {file && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>}
            </Field>
          ) : (
            <Field label="URL externa *">
              <input
                type="url"
                value={externalUrl}
                onChange={e => setExternalUrl(e.target.value)}
                className="input-text w-full"
                placeholder={kind === "video_link" ? "https://youtube.com/watch?v=…" : "https://…"}
              />
            </Field>
          )}

          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={studentVisible}
              onChange={e => setStudentVisible(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
              <strong>Visible para alumnos</strong>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Aparecerá en su biblioteca filtrado por nivel. Útil para vídeos y enlaces de estudio.
              </span>
            </span>
          </label>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary text-sm">
            {submitting ? "Subiendo…" : "Subir"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{label}</div>
      {children}
    </label>
  );
}
