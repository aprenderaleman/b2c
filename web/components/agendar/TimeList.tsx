"use client";

/**
 * Vertical list of time slots for the selected day. Each slot shows
 * the time on the left and the teacher's first name on the right.
 *
 * Tap = select + auto-advance (the parent decides what "advance"
 * means — usually pushing the next URL). Following the Google Meet /
 * Calendly pattern: in mobile, taps ARE the decision; we don't ask
 * the user to also press "Continue".
 *
 * Dual-TZ (Gelfis 2026-06-15): si el lead viene de una zona horaria
 * distinta a Europe/Berlin (caso típico: LATAM), mostramos AMBAS horas
 * — la suya prominente y la del profesor (Berlín) más pequeña debajo —
 * para evitar el bug recurrente de leads que se presentan a su hora local.
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
  /** TZ del lead detectada del navegador. Si es Europe/Berlin o null,
   * mostramos solo una hora. Si es distinta, mostramos las dos. */
  leadTimezone?: string | null;
};

function timeInTz(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: tz,
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

export function TimeList({ slots, selectedIso, selectedTeacherId, onSelect, lightMode = false, leadTimezone = null }: Props) {
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

  const showDual = !!leadTimezone && leadTimezone !== "Europe/Berlin";

  return (
    <div className="flex flex-col gap-2">
      {slots.map(s => {
        const selected = selectedIso === s.startIso && selectedTeacherId === s.teacherId;
        const localTime  = showDual ? timeInTz(s.startIso, leadTimezone as string) : null;
        const berlinTime = timeInTz(s.startIso, "Europe/Berlin");
        return (
          <button
            key={`${s.startIso}-${s.teacherId}`}
            type="button"
            onClick={() => onSelect(s)}
            className={[
              "w-full px-4 rounded-2xl flex items-center justify-center",
              showDual ? "h-16 flex-col gap-0.5 py-2" : "h-14",
              "transition active:scale-[0.99]",
              selected
                ? "bg-warm text-warm-foreground shadow-lg shadow-warm/20"
                : (lightMode
                    ? "bg-slate-100 text-slate-900 hover:bg-slate-200"
                    : "bg-white/[0.06] text-white hover:bg-white/[0.10]"),
            ].join(" ")}
            aria-pressed={selected}
          >
            {showDual ? (
              <>
                <span className="text-lg font-bold tabular-nums leading-none">
                  {localTime} <span className="text-[11px] font-medium opacity-75">tu hora</span>
                </span>
                <span className={`text-[11.5px] tabular-nums leading-none ${selected ? "opacity-90" : "opacity-65"}`}>
                  {berlinTime} Berlín
                </span>
              </>
            ) : (
              <span className="text-lg font-bold tabular-nums">
                {berlinTime}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
