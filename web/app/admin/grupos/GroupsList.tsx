"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Teacher = { id: string; full_name: string | null; email: string };

type Member = {
  student_id: string;
  full_name:  string | null;
  email:      string;
  level:      string | null;
};

type UpcomingClass = {
  id:               string;
  scheduled_at:     string;
  duration_minutes: number;
  title:            string;
  status:           string;
};

type Recording = {
  id:           string;
  class_id:     string;
  class_title:  string;
  class_date:   string;
  file_url:     string | null;
  duration_sec: number | null;
};

type Group = {
  id:               string;
  name:             string;
  class_type:       "group" | "individual";
  level:            string | null;
  teacher_id:       string | null;
  start_date:       string | null;
  end_date:         string | null;
  meet_link:        string | null;
  document_url:     string | null;
  active:           boolean;
  teacher_name:     string | null;
  members:          Member[];
  upcoming_classes: UpcomingClass[];
  latest_recording: Recording | null;
};

/**
 * Admin UI to list, create and edit student_groups. Inline card for each
 * group + a modal for the create/edit form. Delete = soft-archive
 * (active = false) so historical classes keep their group link.
 */
export function GroupsList({
  groups,
  teachers,
}: {
  groups:   Group[];
  teachers: Teacher[];
}) {
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const active = groups.filter(g => g.active);
  const archived = groups.filter(g => !g.active);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {active.length} activo{active.length === 1 ? "" : "s"} · {archived.length} archivado{archived.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nuevo grupo
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {active.map(g => (
          <GroupCard key={g.id} group={g} onEdit={() => setEditing(g)} />
        ))}
      </div>

      {archived.length > 0 && (
        <details className="pt-4">
          <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-brand-500">
            Archivados ({archived.length})
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2 opacity-70">
            {archived.map(g => (
              <GroupCard key={g.id} group={g} onEdit={() => setEditing(g)} />
            ))}
          </div>
        </details>
      )}

      {(editing || creating) && (
        <GroupModal
          group={editing}
          teachers={teachers}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function GroupCard({ group, onEdit }: { group: Group; onEdit: () => void }) {
  return (
    <article className={`rounded-3xl border bg-white dark:bg-slate-900 p-4 space-y-4
      ${group.active ? "border-slate-200 dark:border-slate-800" : "border-slate-200/50 dark:border-slate-800/50 border-dashed"}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{group.name}</h3>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span className="capitalize">{group.class_type === "individual" ? "Individual" : "Grupal"}</span>
            {group.level && <><span>·</span><span>{group.level}</span></>}
            <span>·</span>
            <span>{group.members.length} alumno{group.members.length === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{group.teacher_name ?? "sin profe"}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-xs rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600"
        >
          Editar
        </button>
      </header>

      {/* ── Upcoming schedule ── */}
      {group.upcoming_classes.length > 0 ? (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Próximas clases
          </h4>
          <ul className="space-y-1">
            {group.upcoming_classes.map(c => (
              <li key={c.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0" aria-hidden />
                <span className="capitalize">{formatShortDate(c.scheduled_at)}</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono">{formatTime(c.scheduled_at)}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500 dark:text-slate-400">{c.duration_minutes} min</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic">Sin clases agendadas</p>
      )}

      {/* ── Members ── */}
      {group.members.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Miembros
          </h4>
          <div className="flex items-center gap-1.5 flex-wrap">
            {group.members.map(m => (
              <span
                key={m.student_id}
                title={m.email}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200"
              >
                {m.full_name ?? m.email}
                {m.level && <span className="text-[9px] text-slate-500">· {m.level}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer: doc / meet / latest recording ── */}
      <div className="flex items-center gap-2 flex-wrap text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
        {group.document_url
          ? <a href={group.document_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline">📄 Google Doc</a>
          : <span className="text-slate-400 dark:text-slate-600">📄 sin doc</span>}
        {group.latest_recording?.file_url && (
          <a
            href={group.latest_recording.file_url}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-100 px-2.5 py-1 font-medium"
            title={`Grabación de "${group.latest_recording.class_title}" del ${formatShortDate(group.latest_recording.class_date)}`}
          >
            🎬 Última grabación
            <span className="text-[10px] opacity-70">· {formatShortDate(group.latest_recording.class_date)}</span>
          </a>
        )}
        {group.meet_link && (
          <a href={group.meet_link} target="_blank" rel="noopener" className="text-slate-500 dark:text-slate-400 hover:underline">🔗 meet legacy</a>
        )}
      </div>
    </article>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "short", day: "2-digit", month: "short",
    timeZone: "Europe/Berlin",
  }).replace(/\./g, "");
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function GroupModal({
  group, teachers, onClose, onSaved,
}: {
  group:    Group | null;
  teachers: Teacher[];
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const isNew = !group;

  const [name,        setName]        = useState(group?.name ?? "");
  const [classType,   setClassType]   = useState<"group" | "individual">(group?.class_type ?? "group");
  const [level,       setLevel]       = useState(group?.level ?? "");
  const [teacherId,   setTeacherId]   = useState(group?.teacher_id ?? "");
  const [meetLink,    setMeetLink]    = useState(group?.meet_link ?? "");
  const [documentUrl, setDocumentUrl] = useState(group?.document_url ?? "");
  const [active,      setActive]      = useState(group?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setError(null);
    if (!name.trim()) { setError("El nombre es obligatorio."); return; }
    const payload = {
      name:         name.trim(),
      class_type:   classType,
      level:        level || null,
      teacher_id:   teacherId || null,
      meet_link:    meetLink.trim() || null,
      document_url: documentUrl.trim() || null,
      ...(group ? { active } : {}),
    };
    const url = isNew ? "/api/admin/groups" : `/api/admin/groups/${group!.id}`;
    const method = isNew ? "POST" : "PATCH";

    start(async () => {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.message ?? data?.error ?? "Error al guardar"); return; }
      onSaved();
    });
  };

  const archive = () => {
    if (!group) return;
    if (!confirm(`¿Archivar el grupo "${group.name}"? Dejará de verse pero las clases pasadas conservan su vínculo.`)) return;
    start(async () => {
      const res = await fetch(`/api/admin/groups/${group.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data?.message ?? data?.error ?? "Error"); return; }
      onSaved();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] overflow-y-auto">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            {isNew ? "Nuevo grupo" : "Editar grupo"}
          </h2>
        </header>

        <div className="p-6 space-y-4">
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-text" maxLength={200}
              placeholder="Ej. Deutsch A2 Abends" />
          </Field>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Tipo">
              <select value={classType} onChange={(e) => setClassType(e.target.value as typeof classType)} className="input-text">
                <option value="group">Grupal</option>
                <option value="individual">Individual</option>
              </select>
            </Field>
            <Field label="Nivel (opcional)">
              <select value={level} onChange={(e) => setLevel(e.target.value)} className="input-text">
                <option value="">—</option>
                {["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Profesor">
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="input-text">
              <option value="">Sin asignar</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.full_name ?? t.email}</option>
              ))}
            </select>
          </Field>

          <Field label="Google Doc (URL)">
            <input type="url" value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)}
              className="input-text" placeholder="https://docs.google.com/document/d/…/edit" />
            {documentUrl && (
              <a href={documentUrl} target="_blank" rel="noopener"
                className="mt-1 inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline">
                Abrir para probar →
              </a>
            )}
          </Field>

          <Field label="Meet link legacy (Zoom) — opcional">
            <input type="url" value={meetLink} onChange={(e) => setMeetLink(e.target.value)}
              className="input-text" placeholder="https://us06web.zoom.us/…" />
          </Field>

          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Activo
            </label>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            {!isNew && group?.active && (
              <button type="button" onClick={archive} disabled={pending}
                className="text-xs text-red-600 dark:text-red-400 hover:underline">
                Archivar grupo
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancelar</button>
            <button type="button" className="btn-primary"   onClick={save}    disabled={pending}>
              {pending ? "Guardando…" : (isNew ? "Crear grupo" : "Guardar")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
