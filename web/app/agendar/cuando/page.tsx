"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { StepFrame } from "@/components/agendar/FunnelShell";
import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { useBookingState } from "@/lib/booking-state";
import { useLang } from "@/lib/lang-context";
import { normalizePhone } from "@/lib/phone";
import { firePixelSchedule } from "@/lib/pixels";

/**
 * Step 1 — slot picker. Mobile pattern: horizontal day strip + vertical
 * time list. Tapping a time selects + auto-advances to step 2 (no
 * "Continue" button on this step — the tap is the decision).
 *
 * Reuses the same `/api/public/trial-slots` endpoint as the legacy
 * desktop funnel, so the LMS scheduling logic is unchanged.
 */
function berlinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function fullDateLabel(key: string): string {
  // key is "YYYY-MM-DD" in Berlin TZ. Reconstruct as a Date at noon
  // UTC to dodge any DST surprises before formatting.
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
  });
}

export default function StepCuando() {
  const router = useRouter();
  const { lang } = useLang();
  const { state, update, hydrated } = useBookingState();

  const [slots,    setSlots]    = useState<SlotItem[] | null>(null);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [selectedDay, setDay]   = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, []);

  // Build (day → slots) map once we have data.
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

  // Auto-pick: prefer the day already selected (return-from-step-2),
  // else the first day with availability.
  useEffect(() => {
    if (!hydrated || !slots || slots.length === 0 || selectedDay) return;
    const fromState = state.slot_iso ? berlinDateKey(new Date(state.slot_iso)) : null;
    if (fromState && daysWithSlots.has(fromState)) {
      setDay(fromState);
    } else {
      setDay(berlinDateKey(new Date(slots[0].startIso)));
    }
  }, [hydrated, slots, selectedDay, state.slot_iso, daysWithSlots]);

  const slotsToday: SlotItem[] = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  const onPickSlot = async (s: SlotItem) => {
    update({
      slot_iso:     s.startIso,
      teacher_id:   s.teacherId,
      teacher_name: s.teacherName,
    });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }

    // Hand-off desde el funnel `/diagnostico`: el lead ya nos dio
    // nombre, email, teléfono, nivel y objetivo en el quiz. No tiene
    // sentido pedirle que rellene los pasos /tu /nivel /objetivo
    // otra vez. Submeteamos directo a book-trial con todos los
    // datos y redirigimos a /confirmacion.
    if (state.from_diagnostico
        && state.name && state.email
        && state.phone_local && state.country_code
        && state.german_level && state.goal) {
      if (submitting) return;
      setSubmitting(true);
      setSubmitErr(null);
      try {
        const whatsapp_e164 = normalizePhone(
          `${state.country_code} ${state.phone_local}`,
          state.country_code.replace("+", ""),
        );
        const res = await fetch("/api/public/book-trial", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:          state.name.trim(),
            email:         state.email.trim().toLowerCase(),
            whatsapp_e164,
            whatsapp_raw:  `${state.country_code} ${state.phone_local}`,
            german_level:  state.german_level,
            goal:          state.goal,
            language:      lang,
            slot_iso:      s.startIso,
            teacher_id:    s.teacherId,
            gdpr_accepted: true,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setSubmitErr(json.error ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
          setSubmitting(false);
          return;
        }
        if (state.lead_id) firePixelSchedule({ leadId: state.lead_id });
        // Limpiar booking-state — la sesión se cierra aquí.
        try { sessionStorage.removeItem("b2c.agendar.v1"); } catch { /* ignore */ }
        // Hard nav para que `/confirmacion` cargue limpio sin que el
        // guard de /agendar/* haga ping-pong.
        if (typeof window !== "undefined") window.location.href = "/confirmacion";
      } catch (e) {
        console.error("[agendar/cuando] direct submit failed:", e);
        setSubmitErr("Error de conexión. Inténtalo de nuevo.");
        setSubmitting(false);
      }
      return;
    }

    // Flujo normal — usuario que entró directo a `/agendar/cuando`
    // sin pasar por el quiz. Sigue la ruta de 4 pasos.
    router.push("/agendar/tu");
  };

  return (
    <StepFrame
      title="Tu clase de alemán de prueba"
      subtitle="100% gratis · 45 min con profesor nativo · online · sin compromiso"
    >
      {/* Loading skeleton — keeps the layout stable while slots load */}
      {slots === null && !loadErr && (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 w-14 h-[68px] rounded-2xl bg-white/[0.06] animate-pulse" />
            ))}
          </div>
          <div className="space-y-2 mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {loadErr && <p className="text-sm text-red-300">{loadErr}</p>}

      {submitting && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3
                        text-sm text-white/80 flex items-center gap-3">
          <span className="inline-block h-4 w-4 rounded-full border-2 border-warm border-t-transparent animate-spin" aria-hidden />
          Confirmando tu clase…
        </div>
      )}
      {submitErr && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {submitErr}
        </div>
      )}

      {slots && slots.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/65">
          Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te
          avisamos en cuanto se abran horarios.
        </div>
      )}

      {slots && slots.length > 0 && (
        <div className="space-y-5">
          <MobileDayStrip
            daysWithSlots={daysWithSlots}
            selectedDay={selectedDay}
            onSelect={setDay}
          />

          {selectedDay && (
            <div>
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
    </StepFrame>
  );
}
