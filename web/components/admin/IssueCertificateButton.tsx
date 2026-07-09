"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type CertType = "classes_50" | "classes_100" | "level_a1" | "level_a2" | "level_b1" | "level_b2" | "level_c1" | "exam_passed";

const LABELS: Record<CertType, string> = {
  classes_50:  "50 clases completadas",
  classes_100: "100 clases completadas",
  level_a1:    "Nivel A1 alcanzado",
  level_a2:    "Nivel A2 alcanzado",
  level_b1:    "Nivel B1 alcanzado",
  level_b2:    "Nivel B2 alcanzado",
  level_c1:    "Nivel C1 alcanzado",
  exam_passed: "Examen oficial aprobado",
};

export function IssueCertificateButton({
  studentId,
  teacherName,
}: {
  studentId: string;
  teacherName?: string;
}) {
  const router = useRouter();
  const [open,       setOpen]       = useState(false);
  const [type,       setType]       = useState<CertType>("level_b1");
  const [extra,      setExtra]      = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState(new Date().toISOString().slice(0, 10));
  const [totalHours, setTotalHours] = useState("");
  const [teacher,    setTeacher]    = useState(teacherName ?? "");
  const [pending, startTransition]  = useTransition();
  const [error,      setError]      = useState<string | null>(null);

  const isLevelOrExam = type.startsWith("level_") || type === "exam_passed";

  const submit = () => {
    if (isLevelOrExam && !dateFrom) { setError("Indica la fecha de inicio del curso."); return; }
    if (isLevelOrExam && !totalHours) { setError("Indica las horas totales del curso."); return; }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/students/${studentId}/certificates`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          type,
          extraLabel: type === "exam_passed" ? (extra.trim() || null) : null,
          dateFrom:   isLevelOrExam ? dateFrom : null,
          dateTo:     isLevelOrExam ? dateTo : null,
          totalHours: isLevelOrExam ? Number(totalHours) : null,
          teacherName: teacher.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al emitir.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-full border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20"
      >
        🏅 Emitir certificado
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] overflow-y-auto">
            <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Emitir certificado</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Se generará un Zertifikat profesional en alemán. El estudiante recibirá una notificación.
              </p>
            </header>
            <div className="p-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Tipo de certificado</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as CertType)}
                  className="input-text mt-1"
                >
                  {(Object.keys(LABELS) as CertType[]).map(k => (
                    <option key={k} value={k}>{LABELS[k]}</option>
                  ))}
                </select>
              </label>

              {type === "exam_passed" && (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Examen (ej. &quot;Goethe B2&quot;)</span>
                  <input
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    className="input-text mt-1"
                    placeholder="Goethe B2"
                    maxLength={200}
                  />
                </label>
              )}

              {isLevelOrExam && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Inicio del curso</span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="input-text mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Fin del curso</span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="input-text mt-1"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Horas totales (Unterrichtsstunden)</span>
                    <input
                      type="number"
                      min="1"
                      value={totalHours}
                      onChange={(e) => setTotalHours(e.target.value)}
                      className="input-text mt-1"
                      placeholder="40"
                    />
                  </label>
                </>
              )}

              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nombre del profesor</span>
                <input
                  value={teacher}
                  onChange={(e) => setTeacher(e.target.value)}
                  className="input-text mt-1"
                  placeholder="Sabine Arning"
                />
              </label>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
                {pending ? "Emitiendo…" : "Emitir certificado"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
