"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Rescate del setter: reagendar la cita del lead EN la llamada, usando
 * el booking existente. Carga los huecos públicos (trial-slots o
 * sesion-slots según el tipo de cita) y confirma con nota obligatoria.
 * El contacto 'agendar_prueba' se registra solo en el backend.
 */

type TrialSlot = { startIso: string; teacherId: string; teacherName: string };
type SesionSlot = { startIso: string; closerId: string; closerName: string };

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  }) + " (Berlín)";
}

export function SetterRescateButton({
  leadId,
  classId,
  tipo,
}: {
  leadId: string;
  classId: string;
  tipo: "trial" | "sesion";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [slots, setSlots] = useState<Array<TrialSlot | SesionSlot>>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selected, setSelected] = useState<string>("");   // startIso|hostId
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<string>("llamada");

  useEffect(() => {
    if (!open) return;
    setSlotsLoading(true);
    setError(null);
    const url = tipo === "trial" ? "/api/public/trial-slots" : "/api/public/sesion-slots";
    fetch(url)
      .then(r => r.json())
      .then(body => setSlots((body?.slots ?? []) as Array<TrialSlot | SesionSlot>))
      .catch(() => setError("No se pudieron cargar los horarios."))
      .finally(() => setSlotsLoading(false));
  }, [open, tipo]);

  const submit = () => {
    setError(null);
    if (!selected) { setError("Elige un horario."); return; }
    if (note.trim().length < 5) {
      setError("La nota es obligatoria (mínimo 5 caracteres): qué dijo el lead.");
      return;
    }
    const [startIso, hostId] = selected.split("|");
    start(async () => {
      const res = await fetch(`/api/setter/leads/${leadId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          class_id: classId,
          new_start_iso: startIso,
          ...(tipo === "trial" ? { new_teacher_id: hostId } : { closer_id: hostId }),
          note: note.trim(),
          channel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body?.error === "slot_taken"
            ? "Ese horario ya no está disponible — elige otro."
            : (body?.message ?? body?.error ?? "No se pudo reagendar."),
        );
        return;
      }
      setOkMsg(`Cita reagendada: ${body?.new_start_label ?? fmtSlot(startIso)}. El lead recibe la confirmación automática.`);
      setNote("");
      setSelected("");
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setOkMsg(null); }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 px-3 py-2 text-sm font-medium transition-colors"
      >
        🔄 Rescate: reagendar cita
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Reagendar {tipo === "trial" ? "clase de prueba" : "sesión de plan"}
            </h3>

            {okMsg ? (
              <>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">{okMsg}</p>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setOpen(false)} className="btn-primary text-sm">Listo</button>
                </div>
              </>
            ) : (
              <>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">Nuevo horario</span>
                  {slotsLoading ? (
                    <p className="mt-1 text-sm text-slate-500">Cargando horarios…</p>
                  ) : (
                    <select value={selected} onChange={(e) => setSelected(e.target.value)} className="input-text mt-1 w-full">
                      <option value="">— Elige un horario —</option>
                      {slots.map((s) => {
                        const hostId = "teacherId" in s ? s.teacherId : s.closerId;
                        const hostName = "teacherName" in s ? s.teacherName : s.closerName;
                        return (
                          <option key={`${s.startIso}|${hostId}`} value={`${s.startIso}|${hostId}`}>
                            {fmtSlot(s.startIso)} · {hostName}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </label>

                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">Canal</span>
                  <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input-text mt-1 w-full">
                    <option value="llamada">Llamada</option>
                    <option value="whatsapp">WhatsApp (mi número)</option>
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">Nota (obligatoria) — qué dijo el lead</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="input-text mt-1 w-full"
                    placeholder="Ej: Faltó por trabajo. Reagendado en llamada, confirma que el martes sí puede."
                  />
                </label>

                {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-2">
                    Cancelar
                  </button>
                  <button type="button" onClick={submit} disabled={pending || slotsLoading} className="btn-primary text-sm">
                    {pending ? "Reagendando…" : "Confirmar nueva cita"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
