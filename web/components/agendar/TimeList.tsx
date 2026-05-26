"use client";

/**
 * Vertical list of time slots for the selected day. Each slot shows
 * the time on the left and the teacher's first name on the right.
 *
 * Tap = select + auto-advance (the parent decides what "advance"
 * means — usually pushing the next URL). Following the Google Meet /
 * Calendly pattern: in mobile, taps ARE the decision; we don't ask
 * the user to also press "Continue".
 */

export type SlotItem = { startIso: string; teacherId: string; teacherName: string };

type Props = {
  slots:        SlotItem[];
  selectedIso:  string | null;
  selectedTeacherId: string | null;
  onSelect:     (s: SlotItem) => void;
  /** Light theme (2026-05-26) — usado en /diagnostico/funnel. Default
   * false → tema oscuro para /agendar/cuando. */
  lightMode?:   boolean;
};

function timeIn(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

export function TimeList({ slots, selectedIso, selectedTeacherId, onSelect, lightMode = false }: Props) {
  if (slots.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed p-6 text-center text-sm ${
        lightMode
          ? "border-slate-200 bg-slate-50 text-slate-500"
          : "border-white/10 bg-white/[0.03] text-white/55"
      }`}>
        Sin huecos para este día. Prueba otro día arriba.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {slots.map(s => {
        const selected = selectedIso === s.startIso && selectedTeacherId === s.teacherId;
        return (
          <button
            key={`${s.startIso}-${s.teacherId}`}
            type="button"
            onClick={() => onSelect(s)}
            className={[
              "w-full h-14 px-4 rounded-2xl flex items-center justify-center",
              "transition active:scale-[0.99]",
              selected
                ? "bg-warm text-warm-foreground shadow-lg shadow-warm/20"
                : (lightMode
                    ? "bg-slate-100 text-slate-900 hover:bg-slate-200"
                    : "bg-white/[0.06] text-white hover:bg-white/[0.10]"),
            ].join(" ")}
            aria-pressed={selected}
          >
            <span className="text-lg font-bold tabular-nums">
              {timeIn(s.startIso)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
