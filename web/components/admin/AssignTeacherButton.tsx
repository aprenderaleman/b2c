"use client";

/**
 * "Asignar profe" — botón de la ficha del estudiante (/admin/estudiantes/[id]).
 * Gelfis 2026-11-25.
 *
 * Elige el profe y la plataforma hace el resto: cambia el grupo, las clases
 * futuras, el chat y el documento de apuntes, y avisa por el chat a los
 * involucrados (alumno como Stiv, profe nuevo, profe anterior y profe de la
 * prueba). Antes de confirmar se ven los mensajes exactos que se enviarán.
 * Si el alumno tenía avisos de asignación anteriores sin leer, se retiran
 * para que solo vea el dato vigente.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Options = {
  student: { id: string; fullName: string; neverLoggedIn: boolean; hasPhone: boolean; active: boolean };
  currentTeacher: { teacherId: string; fullName: string } | null;
  trialTeacher: { teacherId: string; fullName: string } | null;
  teachers: Array<{ id: string; fullName: string; activeStudents: number }>;
};
type Preview = {
  notices: { toStudent: string; toNewTeacher: string; toOldTeacher: string | null; toTrialTeacher: string | null };
  recipients: { student: string; newTeacher: string; oldTeacher: string | null; trialTeacher: string | null };
  cleanup: { unreadNoticesToDelete: number; welcomeWillBeFixed: boolean };
};
type NotifyKey = "student" | "newTeacher" | "oldTeacher" | "trialTeacher";

export function AssignTeacherButton({ studentId, studentName }: { studentId: string; studentName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [note, setNote] = useState("");
  const [includePhone, setIncludePhone] = useState(true);
  const [notify, setNotify] = useState<Record<NotifyKey, boolean>>({ student: true, newTeacher: true, oldTeacher: true, trialTeacher: true });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const url = `/api/admin/students/${studentId}/reassign-teacher`;

  const openModal = () => {
    setOpen(true); setOptions(null); setLoadError(null); setTeacherId(""); setNote(""); setIncludePhone(true);
    setNotify({ student: true, newTeacher: true, oldTeacher: true, trialTeacher: true });
    setPreview(null); setPreviewError(null); setError(null); setDone(null);
    fetch(url, { cache: "no-store" })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setOptions(j as Options); })
      .catch(e => setLoadError(e instanceof Error ? e.message : "Error"));
  };

  // Vista previa de los mensajes: se recalcula al cambiar profe, nota o WhatsApp.
  useEffect(() => {
    if (!open || !teacherId) { setPreview(null); setPreviewError(null); return; }
    let alive = true;
    setPreviewLoading(true);
    const t = setTimeout(() => {
      fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ newTeacherId: teacherId, note: note.trim() || null, includePhone, dryRun: true }),
      })
        .then(async r => { const j = await r.json().catch(() => ({})); if (!alive) return; if (!r.ok) { setPreview(null); setPreviewError(j.error ?? `HTTP ${r.status}`); } else { setPreview(j as Preview); setPreviewError(null); } })
        .catch(e => { if (alive) { setPreview(null); setPreviewError(e instanceof Error ? e.message : "Error"); } })
        .finally(() => { if (alive) setPreviewLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [open, teacherId, note, includePhone, url]);

  const rows = useMemo(() => {
    if (!preview) return [];
    const r: Array<{ key: NotifyKey; who: string; role: string; text: string }> = [
      { key: "newTeacher", who: preview.recipients.newTeacher, role: "profe nuevo", text: preview.notices.toNewTeacher },
    ];
    if (preview.notices.toOldTeacher && preview.recipients.oldTeacher) r.push({ key: "oldTeacher", who: preview.recipients.oldTeacher, role: "profe anterior", text: preview.notices.toOldTeacher });
    if (preview.notices.toTrialTeacher && preview.recipients.trialTeacher) r.push({ key: "trialTeacher", who: preview.recipients.trialTeacher, role: "dio la clase de prueba", text: preview.notices.toTrialTeacher });
    r.push({ key: "student", who: preview.recipients.student, role: "estudiante, lo recibe de Stiv", text: preview.notices.toStudent });
    return r;
  }, [preview]);

  const submit = async () => {
    if (!teacherId || !preview || saving) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ newTeacherId: teacherId, note: note.trim() || null, includePhone, notify }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const sentTo = rows.filter(r => j.sent?.[r.key]).map(r => r.who);
      const extra = [
        j.cleanup?.deleted ? `${j.cleanup.deleted} aviso(s) anterior(es) sin leer retirado(s)` : null,
        j.cleanup?.welcomeFixed ? "bienvenida corregida" : null,
        ...(Array.isArray(j.warnings) ? j.warnings : []),
      ].filter(Boolean).join(" · ");
      setDone(`Asignado a ${j.newTeacher}. ${sentTo.length ? `Avisados por chat: ${sentTo.join(", ")}.` : "No se envió ningún aviso."}${extra ? ` ${extra}.` : ""}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al asignar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs font-medium rounded-full border border-sky-300 dark:border-sky-500/40 bg-sky-50 dark:bg-sky-500/10 px-3 py-1 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-500/20"
      >
        👩‍🏫 Asignar profe
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog" aria-modal="true" aria-label="Asignar profe"
          onClick={(e) => { if (e.target === e.currentTarget && !saving) setOpen(false); }}
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] overflow-y-auto">
            <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Asignar profe a {studentName}</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {options
                  ? <>Profe actual: <strong>{options.currentTeacher?.fullName ?? "sin asignar"}</strong>{options.trialTeacher ? <> · Clase de prueba: {options.trialTeacher.fullName}</> : null}</>
                  : loadError ? `No se pudo cargar: ${loadError}` : "Cargando…"}
              </p>
            </header>

            {done ? (
              <div className="p-6 space-y-4">
                <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">✅ {done}</p>
                <div className="flex justify-end">
                  <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-6 space-y-4">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nuevo profe</span>
                    <select
                      className="input-text mt-1 w-full"
                      value={teacherId}
                      disabled={!options || saving}
                      onChange={e => setTeacherId(e.target.value)}
                    >
                      <option value="">Elige un profe…</option>
                      {(options?.teachers ?? []).map(t => (
                        <option key={t.id} value={t.id} disabled={t.id === options?.currentTeacher?.teacherId}>
                          {t.fullName} · {t.activeStudents} alumno{t.activeStudents === 1 ? "" : "s"}{t.id === options?.currentTeacher?.teacherId ? " (actual)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nota para el profe (opcional)</span>
                    <textarea
                      className="input-text mt-1 w-full" rows={2} maxLength={500}
                      value={note} disabled={saving}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Ej.: pidió clases por la mañana a las 7:00"
                    />
                    <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Va tal cual en el mensaje al profe nuevo. El estudiante no la ve.</span>
                  </label>

                  {options?.student.hasPhone && (
                    <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <input type="checkbox" className="mt-0.5" checked={includePhone} disabled={saving} onChange={e => setIncludePhone(e.target.checked)} />
                      <span>Incluir el WhatsApp del estudiante en el mensaje al profe, por si no contesta por el chat</span>
                    </label>
                  )}

                  {teacherId && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Mensajes que se enviarán por chat {previewLoading ? <span className="text-xs font-normal text-slate-400">· actualizando…</span> : null}
                      </p>
                      {previewError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{previewError}</p>}
                      {rows.map(r => (
                        <div key={r.key} className={`rounded-2xl border p-3 ${notify[r.key] ? "border-slate-200 dark:border-slate-700" : "border-slate-200 dark:border-slate-800 opacity-60"}`}>
                          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            <input type="checkbox" checked={notify[r.key]} disabled={saving} onChange={e => setNotify(n => ({ ...n, [r.key]: e.target.checked }))} />
                            <span>{r.who} <span className="font-normal text-slate-500 dark:text-slate-400">· {r.role}</span></span>
                          </label>
                          <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{r.text}</p>
                        </div>
                      ))}
                      {preview && (preview.cleanup.unreadNoticesToDelete > 0 || preview.cleanup.welcomeWillBeFixed) && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Limpieza del chat del estudiante (solo mensajes que aún no ha leído):{" "}
                          {[
                            preview.cleanup.unreadNoticesToDelete > 0 && notify.student ? `se retira${preview.cleanup.unreadNoticesToDelete === 1 ? "" : "n"} ${preview.cleanup.unreadNoticesToDelete} aviso${preview.cleanup.unreadNoticesToDelete === 1 ? "" : "s"} de profe anterior` : null,
                            preview.cleanup.welcomeWillBeFixed ? "se corrige el nombre del profe en su bienvenida" : null,
                          ].filter(Boolean).join(" y ") || "nada que retirar"}.
                        </p>
                      )}
                    </div>
                  )}

                  {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
                </div>

                <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>Cancelar</button>
                  <button type="button" className="btn-primary" onClick={submit} disabled={!teacherId || !preview || previewLoading || saving}>
                    {saving ? "Asignando…" : "Asignar y avisar"}
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
