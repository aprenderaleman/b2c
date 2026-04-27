"use client";

import { useEffect, useMemo, useRef } from "react";

/**
 * Horizontal day strip — the mobile-native pattern (Cal.com, Calendly,
 * Booksy). 14 days starting today, scroll-snap horizontally. A dot
 * under each tile signals "has slots". Tap → selects that day.
 *
 * Berlin TZ throughout: all date keys are produced from the same
 * `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" })` the
 * server uses, so client and API stay in lockstep.
 */

type Props = {
  daysWithSlots: Set<string>;            // Berlin "YYYY-MM-DD" keys
  selectedDay:   string | null;
  onSelect:      (key: string) => void;
};

const DOW_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function berlinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function berlinDow(d: Date): string {
  // 0..6 in Berlin TZ. We can't use d.getDay() directly because that
  // honours the visitor's local TZ; instead, parse the en-CA key back.
  const key = berlinDateKey(d);
  const [y, m, day] = key.split("-").map(Number);
  // Construct a UTC date so getUTCDay() gives a stable answer.
  const utc = new Date(Date.UTC(y, m - 1, day));
  return DOW_ES[utc.getUTCDay()];
}

function berlinDayOfMonth(d: Date): number {
  const key = berlinDateKey(d);
  return Number(key.split("-")[2]);
}

export function MobileDayStrip({ daysWithSlots, selectedDay, onSelect }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const days = useMemo(() => {
    const list: { key: string; dow: string; dayOfMonth: number; isToday: boolean; isTomorrow: boolean }[] = [];
    const now = new Date();
    const todayKey = berlinDateKey(now);
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const key = berlinDateKey(d);
      list.push({
        key,
        dow:        berlinDow(d),
        dayOfMonth: berlinDayOfMonth(d),
        isToday:    key === todayKey,
        isTomorrow: i === 1,
      });
    }
    return list;
  }, []);

  // When the selected day changes (e.g. auto-pick on load), make sure
  // it's visible inside the horizontal scroll viewport.
  useEffect(() => {
    if (!selectedRef.current || !stripRef.current) return;
    selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedDay]);

  return (
    <div
      ref={stripRef}
      className="-mx-5 px-5 overflow-x-auto no-scrollbar"
      style={{ scrollSnapType: "x mandatory" }}
    >
      <div className="flex gap-2 py-1">
        {days.map(d => {
          const has      = daysWithSlots.has(d.key);
          const selected = selectedDay === d.key;
          const label    = d.isToday ? "hoy" : d.isTomorrow ? "mañ" : d.dow;
          return (
            <button
              key={d.key}
              ref={selected ? selectedRef : undefined}
              type="button"
              disabled={!has}
              onClick={() => has && onSelect(d.key)}
              style={{ scrollSnapAlign: "center" }}
              className={[
                "shrink-0 w-14 h-[68px] rounded-2xl flex flex-col items-center justify-center gap-0.5",
                "transition active:scale-95",
                selected
                  ? "bg-warm text-warm-foreground shadow-lg shadow-warm/20"
                  : has
                    ? "bg-white/[0.06] text-white hover:bg-white/[0.12]"
                    : "bg-white/[0.03] text-white/30 cursor-not-allowed",
              ].join(" ")}
              aria-pressed={selected}
              aria-label={`${label} ${d.dayOfMonth}${has ? "" : " (sin huecos)"}`}
            >
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                selected ? "text-warm-foreground/80" : "text-white/55"
              }`}>
                {label}
              </span>
              <span className="text-lg font-bold leading-none">
                {d.dayOfMonth}
              </span>
              {has && (
                <span className={`h-1 w-1 rounded-full mt-0.5 ${
                  selected ? "bg-warm-foreground/80" : "bg-warm"
                }`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
