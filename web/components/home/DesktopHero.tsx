"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { useBookingState } from "@/lib/booking-state";
import { useLang } from "@/lib/lang-context";

const COPY = {
  es: {
    eyebrow:    "Cursos online · Niveles A1 a C1",
    h1Pre:      "Aprende ",
    h1Lang:     "alemán",
    h1Mid:      " con un profesor ",
    h1Native:   "nativo",
    h1Post:     " que habla español.",
    sub:        "Certificado oficial reconocido en toda Europa según el MCER. Horario flexible, plan personalizado, desde",
    subPriceFrom: "17 €/h",
    ratingLine: "Calificación de alumnos",
    ratingTail: "cientos",
    ratingTail2: "de estudiantes activos",
    pills: [
      { icon: "🎓", text: "Certificado MCER A1–C1, válido en la UE" },
      { icon: "🗣️", text: "Profesores nativos que hablan español" },
      { icon: "💳", text: "Sin tarjeta · clase de prueba gratis" },
      { icon: "🚀", text: "Plan a medida desde el primer día" },
    ],
    badge:      "100% gratis",
    bookTitle:  "Reserva tu clase de prueba",
    bookSub:    "45 min con profesor nativo · sin compromiso",
    fmtFull:    "es-ES",
    weekdayFmt: "long",
    daySelectedDate: (key: string) => fullDateLabelES(key),
    chooseToContinue: "Elige un horario para continuar",
    continueWith: (slotShort: string) => `Continuar · ${slotShort} →`,
    fineprint:  "Al continuar te pediremos nombre, email, nivel y WhatsApp.\nTarda menos de 2 minutos.",
    reassurance: "✓ Sin tarjeta · ✓ Sin compromiso · ✓ Cancelable en 1 click",
    loadErr:    "No pudimos cargar los horarios. Recarga la página.",
    noSlots:    "Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te avisamos en cuanto se abran horarios.",
  },
  de: {
    eyebrow:    "Online-Kurse · Niveau A1 bis C1",
    h1Pre:      "Lerne ",
    h1Lang:     "Deutsch",
    h1Mid:      " mit einer ",
    h1Native:   "muttersprachlichen Lehrkraft",
    h1Post:     ", die Spanisch spricht.",
    sub:        "Offizielles Zertifikat, europaweit anerkannt nach GER. Flexible Zeiten, individueller Plan, ab",
    subPriceFrom: "17 €/Std.",
    ratingLine: "Bewertung unserer Schüler",
    ratingTail: "Hunderte",
    ratingTail2: "aktive Schüler",
    pills: [
      { icon: "🎓", text: "GER-Zertifikat A1–C1, EU-weit gültig" },
      { icon: "🗣️", text: "Muttersprachliche Lehrkräfte, sprechen Spanisch" },
      { icon: "💳", text: "Keine Karte · Probestunde gratis" },
      { icon: "🚀", text: "Individueller Plan ab dem ersten Tag" },
    ],
    badge:      "100% gratis",
    bookTitle:  "Buche deine Probestunde",
    bookSub:    "45 Min mit muttersprachlicher Lehrkraft · unverbindlich",
    fmtFull:    "de-DE",
    weekdayFmt: "long",
    daySelectedDate: (key: string) => fullDateLabelDE(key),
    chooseToContinue: "Wähle eine Uhrzeit",
    continueWith: (slotShort: string) => `Weiter · ${slotShort} →`,
    fineprint:  "Im nächsten Schritt fragen wir nach Name, E-Mail, Niveau und WhatsApp.\nDauert unter 2 Minuten.",
    reassurance: "✓ Keine Karte · ✓ Unverbindlich · ✓ Kündigbar mit 1 Klick",
    loadErr:    "Termine konnten nicht geladen werden. Bitte Seite neu laden.",
    noSlots:    "Die nächsten 30 Tage sind ausgebucht. Schreib uns per WhatsApp, wir melden uns sobald Termine frei werden.",
  },
} as const;

/**
 * Desktop hero with the booking calendar inline on the right and the
 * marketing copy on the left. This is the single biggest CRO change
 * for desktop — the visitor lands and the calendar is ALREADY
 * actionable above the fold, no "click to enter funnel" indirection.
 *
 * On `lg:` and above the right card becomes `sticky top-24` so it
 * stays in view while the visitor scrolls through profes /
 * testimonios / comparativa / FAQ. Tap a slot anywhere → handoff to
 * /agendar/tu (which already validates from sessionStorage and
 * carries the rest of the funnel).
 *
 * Mobile (`md:` and below) is rendered by HomeFunnelMobile — this
 * component is `hidden md:grid` so the two flows never overlap.
 */

function berlinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function fullDateLabelES(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function fullDateLabelDE(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

function formatSlotShort(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    timeZone: "Europe/Berlin",
    weekday:  "short",
    day:      "numeric",
    month:    "short",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

export function DesktopHero() {
  const router = useRouter();
  const { lang } = useLang();
  const c = COPY[lang === "de" ? "de" : "es"];
  const { state, update } = useBookingState();

  const [slots,    setSlots]    = useState<SlotItem[] | null>(null);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [selectedDay, setDay]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, []);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, SlotItem[]>();
    for (const s of slots ?? []) {
      const key  = berlinDateKey(new Date(s.startIso));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [slots]);

  const daysWithSlots = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (!slots || slots.length === 0 || selectedDay) return;
    setDay(berlinDateKey(new Date(slots[0].startIso)));
  }, [slots, selectedDay]);

  const slotsToday: SlotItem[] = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];
  const hasSelected = state.slot_iso && state.teacher_id;

  const onPickSlot = (s: SlotItem) => {
    update({
      slot_iso:     s.startIso,
      teacher_id:   s.teacherId,
      teacher_name: s.teacherName,
    });
  };

  const onContinue = () => {
    if (!hasSelected) return;
    router.push("/agendar/tu");
  };

  return (
    <section className="hidden md:block relative bg-navy-900 text-white overflow-hidden">
      {/* Subtle radial gradient for depth */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(circle at 20% 0%, rgba(244,162,97,0.18) 0%, transparent 45%), radial-gradient(circle at 100% 100%, rgba(244,162,97,0.10) 0%, transparent 50%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-10 pt-14 pb-20 lg:pt-20 lg:pb-28">
        {/* Right column is fixed at ~460px (Cal.com / Calendly standard).
            Letting it stretch as a fr-fraction made the day strip widen
            to fit 13 tiles, which squeezed the left copy into single-
            word lines on 1440px screens. */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_460px] gap-10 lg:gap-12 xl:gap-16 items-start">

          {/* ── LEFT: marketing copy ───────────────────────── */}
          <div className="lg:pt-6 max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full
                             bg-warm/15 ring-1 ring-warm/40
                             px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-warm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warm opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-warm" />
              </span>
              {c.eyebrow}
            </span>

            <h1 className="mt-5 font-bold tracking-tight text-white
                           text-4xl lg:text-[44px] xl:text-[52px] leading-[1.08]
                           text-balance">
              {c.h1Pre}<span className="text-warm">{c.h1Lang}</span>{c.h1Mid}
              <span className="text-warm">{c.h1Native}</span>{c.h1Post}
            </h1>

            <p className="mt-5 text-lg lg:text-xl font-medium text-white/75 leading-relaxed text-balance">
              {c.sub} <strong className="text-white">{c.subPriceFrom}</strong>.
            </p>

            {/* Rating — real wording, no fake provider claim */}
            <div className="mt-6 inline-flex items-center gap-3 rounded-full
                            bg-white/[0.06] ring-1 ring-white/10
                            px-4 py-2">
              <span className="flex items-center gap-0.5" aria-label="5/5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <svg
                    key={i}
                    width="16" height="16" viewBox="0 0 24 24"
                    className="text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.45)]"
                    fill="currentColor" aria-hidden
                  >
                    <path d="M12 2.5l2.83 6.49 7.07.62-5.36 4.7 1.6 6.92L12 17.6l-6.14 3.63 1.6-6.92L2.1 9.61l7.07-.62L12 2.5z" />
                  </svg>
                ))}
              </span>
              <span className="text-sm font-semibold text-white">
                {c.ratingLine} <span className="text-white/60 font-normal">·</span>{" "}
                <span className="text-warm">{c.ratingTail}</span> {c.ratingTail2}
              </span>
            </div>

            {/* Trust pills */}
            <ul className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg">
              {c.pills.map(item => (
                <li
                  key={item.text}
                  className="flex items-start gap-2.5 rounded-xl bg-white/[0.04] ring-1 ring-white/5 px-3 py-2.5"
                >
                  <span className="text-base shrink-0" aria-hidden>{item.icon}</span>
                  <span className="text-sm text-white/85 leading-snug">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── RIGHT: booking widget ─────────────────────── */}
          <div className="lg:sticky lg:top-24 self-start">
            <div
              className="theme-dark rounded-3xl bg-navy-800/80 backdrop-blur
                         border border-white/10 shadow-2xl shadow-black/40
                         p-6 lg:p-7"
            >
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full
                                   bg-warm/15 ring-1 ring-warm/40 text-warm
                                   px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]">
                    <span className="h-1.5 w-1.5 rounded-full bg-warm" aria-hidden />
                    {c.badge}
                  </span>
                  <h2 className="mt-2 text-xl font-extrabold tracking-tight text-white">
                    {c.bookTitle}
                  </h2>
                  <p className="text-sm text-white/65 mt-0.5">
                    {c.bookSub}
                  </p>
                </div>
              </div>

              {slots === null && !loadErr && <CalendarSkeleton />}

              {loadErr && (
                <p className="text-sm text-red-300 px-1">{c.loadErr}</p>
              )}

              {slots && slots.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-center text-sm text-white/65">
                  {c.noSlots}
                </div>
              )}

              {slots && slots.length > 0 && (
                <div className="space-y-4">
                  <MobileDayStrip
                    daysWithSlots={daysWithSlots}
                    selectedDay={selectedDay}
                    onSelect={setDay}
                  />

                  {selectedDay && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase text-white/55 tracking-wider mb-2 capitalize">
                        {c.daySelectedDate(selectedDay)}
                      </p>
                      <div className="max-h-[280px] overflow-y-auto pr-1 -mr-1">
                        <TimeList
                          slots={slotsToday}
                          selectedIso={state.slot_iso}
                          selectedTeacherId={state.teacher_id}
                          onSelect={onPickSlot}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onContinue}
                    disabled={!hasSelected}
                    className="w-full h-12 rounded-2xl bg-warm text-warm-foreground
                               font-semibold text-base shadow-lg shadow-warm/20
                               active:scale-[0.99] transition flex items-center justify-center gap-2
                               disabled:opacity-50 disabled:active:scale-100"
                  >
                    {hasSelected
                      ? c.continueWith(state.slot_iso ? formatSlotShort(state.slot_iso, c.fmtFull) : "")
                      : c.chooseToContinue}
                  </button>
                </div>
              )}

              <p className="mt-4 text-[11px] text-white/45 text-center leading-relaxed whitespace-pre-line">
                {c.fineprint}
              </p>
            </div>

            {/* Reassurance under the card */}
            <p className="mt-4 text-center text-xs text-white/55">
              {c.reassurance}
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}

function CalendarSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="shrink-0 w-14 h-[68px] rounded-2xl bg-white/[0.06] animate-pulse" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
