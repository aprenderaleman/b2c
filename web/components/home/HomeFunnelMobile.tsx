"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { useBookingState } from "@/lib/booking-state";

/**
 * Mobile-only inline funnel that lives directly on `/`.
 *
 * The visitor lands on the homepage and is ALREADY inside the booking
 * flow — no "tap CTA → open funnel" indirection. Hero copy stays
 * above for SEO + brand context. Below the hero we render:
 *
 *   1. A segmented control to swap between "Agendar" (the inline
 *      calendar) and "WhatsApp" (a deep-link if they prefer to chat).
 *   2. The day strip + time list, full-bleed (no card padding) so it
 *      feels native, not embedded.
 *   3. A floating glassmorphism CTA that materialises the moment a
 *      slot is picked. Tapping it persists the choice to
 *      sessionStorage and pushes /agendar/tu — reusing the same
 *      steps 2-4 the standalone funnel already serves.
 *
 * Desktop is untouched — `app/page.tsx` only renders this under
 * `md:hidden`.
 */

const WA_NUMBER  = "4915253409644";  // mirrors WhatsAppFloat.tsx
const WA_PREFILL = "Hola, tengo una consulta sobre los cursos.";

type Tab = "termin" | "wa";

function berlinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function fullDateLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function formatSlotShort(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "short",
    day:      "numeric",
    month:    "short",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

export function HomeFunnelMobile() {
  const router = useRouter();
  const { state, update } = useBookingState();

  const [tab, setTab] = useState<Tab>("termin");

  // Slots fetch — same endpoint the desktop funnel and /agendar use.
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

  // Auto-pick first available day so times appear instantly.
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
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }
  };

  const onContinue = () => {
    if (!hasSelected) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }
    router.push("/agendar/tu");
  };

  return (
    <>
      <section
        className="theme-dark md:hidden bg-navy-900 text-white"
        style={{ paddingBottom: hasSelected ? "calc(env(safe-area-inset-bottom) + 6.5rem)" : undefined }}
      >
        {/* ── Segmented control ───────────────────────────── */}
        <div className="px-5 pt-2">
          <div
            role="tablist"
            aria-label="Cómo quieres empezar"
            className="relative grid grid-cols-2 h-11 rounded-full bg-white/[0.07] p-1 ring-1 ring-white/10"
          >
            {/* Animated pill behind the active tab */}
            <motion.div
              aria-hidden
              className="absolute top-1 bottom-1 w-[calc(50%-0.25rem)] rounded-full bg-warm shadow-md shadow-warm/30"
              initial={false}
              animate={{ x: tab === "termin" ? 0 : "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
            <TabButton active={tab === "termin"} onClick={() => setTab("termin")}>
              📅 Agendar
            </TabButton>
            <TabButton active={tab === "wa"} onClick={() => setTab("wa")}>
              💬 WhatsApp
            </TabButton>
          </div>
        </div>

        {/* ── Termin tab ──────────────────────────────────── */}
        {tab === "termin" && (
          <div className="pt-5">
            <div className="px-5 mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full
                               bg-warm/15 ring-1 ring-warm/40 text-warm
                               px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-warm" aria-hidden />
                100% gratis
              </span>
              <h2 className="text-[22px] font-extrabold tracking-tight text-white leading-tight">
                Reserva tu clase de alemán de prueba
              </h2>
              <p className="text-sm text-white/65 mt-1.5">
                45 min con un profesor nativo · online · sin compromiso
              </p>
            </div>

            {slots === null && !loadErr && <CalendarSkeleton />}

            {loadErr && (
              <p className="px-5 text-sm text-red-300">{loadErr}</p>
            )}

            {slots && slots.length === 0 && (
              <div className="mx-5 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/65">
                Estamos completos los próximos 30 días. Escríbenos por WhatsApp y
                te avisamos en cuanto se abran horarios.
              </div>
            )}

            {slots && slots.length > 0 && (
              <div className="space-y-5">
                {/* Day strip — full-bleed (no horizontal padding on parent;
                    the strip handles its own edge-to-edge scroll) */}
                <div className="px-5">
                  <MobileDayStrip
                    daysWithSlots={daysWithSlots}
                    selectedDay={selectedDay}
                    onSelect={setDay}
                  />
                </div>

                {selectedDay && (
                  <div className="px-5">
                    <p className="text-[11px] font-semibold uppercase text-white/55 tracking-wider mb-2 capitalize">
                      {fullDateLabel(selectedDay)}
                    </p>
                    <TimeList
                      slots={slotsToday}
                      selectedIso={state.slot_iso}
                      selectedTeacherId={state.teacher_id}
                      onSelect={onPickSlot}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── WhatsApp tab ────────────────────────────────── */}
        {tab === "wa" && (
          <div className="px-5 pt-5">
            <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-[#25D366]/20 flex items-center justify-center">
                  <svg viewBox="0 0 32 32" className="h-6 w-6 fill-[#25D366]" aria-hidden>
                    <path d="M16.003 3.2C9.012 3.2 3.305 8.906 3.302 15.897c-.001 2.234.583 4.415 1.693 6.335L3.2 28.8l6.736-1.77a12.68 12.68 0 006.063 1.544h.005c6.99 0 12.696-5.707 12.699-12.697a12.62 12.62 0 00-3.717-8.989 12.62 12.62 0 00-8.983-3.688zm5.78 17.309c-.264.74-1.53 1.416-2.14 1.507-.547.081-1.238.115-1.998-.126-.461-.147-1.052-.342-1.81-.669-3.184-1.373-5.263-4.575-5.422-4.787-.159-.212-1.296-1.72-1.296-3.282 0-1.562.82-2.33 1.111-2.647.291-.317.635-.397.847-.397l.61.011c.195.01.457-.074.715.545.265.635.9 2.198.98 2.357.079.159.132.344.026.556-.105.212-.157.344-.317.529-.159.185-.332.412-.476.555-.16.159-.325.33-.14.647.185.317.822 1.355 1.764 2.195 1.21 1.079 2.231 1.413 2.548 1.572.317.159.502.132.687-.08.185-.212.793-.927 1.005-1.244.212-.318.424-.265.715-.159.291.106 1.85.873 2.167 1.032.317.158.528.238.608.37.079.132.079.767-.185 1.507z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-white">¿Prefieres preguntar primero?</p>
                  <p className="text-sm text-white/65">Te respondemos en minutos.</p>
                </div>
              </div>
              <a
                href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_PREFILL)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full h-12 rounded-2xl bg-[#25D366] text-white font-semibold
                           text-center leading-[3rem] active:scale-[0.99] transition shadow-md shadow-[#25D366]/20"
              >
                Abrir WhatsApp
              </a>
              <p className="text-xs text-white/55 mt-3 text-center">
                Lun a Vie · 9:00 – 19:00 (CET)
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Floating glass CTA (mobile only) ──────────────── */}
      {/*
        Sits over the page, full-width, glassmorphism. Only renders
        when a slot is picked. Tapping it pushes /agendar/tu, which
        already validates from sessionStorage so the rest of the
        funnel takes over seamlessly.
      */}
      {hasSelected && (
        <motion.div
          className="md:hidden fixed bottom-0 left-0 right-0 z-50"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 360, damping: 32 }}
        >
          <div
            className="border-t border-white/10 bg-navy-900/85 backdrop-blur-xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
          >
            <div className="px-5 pt-3">
              <button
                type="button"
                onClick={onContinue}
                className="w-full h-12 rounded-2xl bg-warm text-warm-foreground font-semibold text-base
                           shadow-lg shadow-warm/30 active:scale-[0.99] transition flex items-center justify-center gap-2"
              >
                <span>Agendar · {state.slot_iso ? formatSlotShort(state.slot_iso) : ""}</span>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative z-10 h-9 inline-flex items-center justify-center
                  text-sm font-semibold rounded-full transition-colors
                  ${active ? "text-warm-foreground" : "text-white/70 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function CalendarSkeleton() {
  return (
    <div className="px-5 space-y-4">
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
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
