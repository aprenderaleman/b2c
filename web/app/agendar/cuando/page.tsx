"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { StepFrame } from "@/components/agendar/FunnelShell";
import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { useBookingState } from "@/lib/booking-state";
import { useLang } from "@/lib/lang-context";
import { normalizePhone, resolvePhone } from "@/lib/phone";
import { combineE164 } from "@/components/diagnostico/DiagnosticoFunnel";
import { firePixelLead, firePixelSchedule } from "@/lib/pixels";
import { detectBrowserTimezone, detectCountryFromBrowser } from "@/lib/timezone-country";

/**
 * Step 1 — slot picker. Mobile pattern: horizontal day strip + vertical
 * time list. Tras seleccionar un slot el flujo varía según el origen:
 *
 *   1. Lead vino del quiz `/diagnostico` (state.from_diagnostico=true)
 *      → tenemos sus datos → auto-submit a book-trial.
 *   2. Lead vino DIRECTO (atajo "Primera clase de prueba GRATIS" en
 *      una landing): mostramos form inline (nombre + email + WhatsApp)
 *      y al confirmar reservamos. Sin pasos /agendar/tu /nivel /objetivo.
 *
 * Reuses the same `/api/public/trial-slots` endpoint as the legacy
 * desktop funnel, so the LMS scheduling logic is unchanged.
 */

function tzDateKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function fullDateLabel(key: string): string {
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
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  // Modal de doble confirmación dual-TZ. Igual que el CalendarStep
  // del DiagnosticoFunnel — exige confirmación extra cuando la TZ del
  // lead difiere de Berlin (caso recurrente: LATAM se presentaba a
  // su hora local).
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  // TZ del lead — para mostrar dual-TZ en slots y agrupar días.
  const [leadTimezone, setLeadTimezone] = useState<string | null>(null);
  useEffect(() => { setLeadTimezone(detectBrowserTimezone()); }, []);
  const displayTz = leadTimezone ?? "Europe/Berlin";
  const showDualTz = !!leadTimezone && leadTimezone !== "Europe/Berlin";

  // Form inline (atajo desde landing). Se inicializa con auto-detect.
  const [form, setForm] = useState({
    name: "", email: "", whatsapp: "", countryCode: "+49",
  });
  // Placeholder del input WhatsApp — número de ejemplo del país detectado.
  const [phonePlaceholder, setPhonePlaceholder] = useState("15253409644");
  useEffect(() => {
    const det = detectCountryFromBrowser();
    if (!det) return;
    setPhonePlaceholder(det.examplePhone);
    setForm(f => (f.countryCode === "+49" ? { ...f, countryCode: det.countryCode } : f));
  }, []);

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
      const key  = tzDateKey(new Date(s.startIso), displayTz);
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [slots, displayTz]);

  const daysWithSlots = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (!hydrated || !slots || slots.length === 0 || selectedDay) return;
    const fromState = state.slot_iso ? tzDateKey(new Date(state.slot_iso), displayTz) : null;
    if (fromState && daysWithSlots.has(fromState)) {
      setDay(fromState);
    } else {
      setDay(tzDateKey(new Date(slots[0].startIso), displayTz));
    }
  }, [hydrated, slots, selectedDay, state.slot_iso, daysWithSlots, displayTz]);

  const slotsToday: SlotItem[] = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  const isFromDiagnostico = !!(
    state.from_diagnostico
    && state.name && state.email
    && state.phone_local && state.country_code
    && state.german_level && state.goal
  );

  const onPickSlot = async (s: SlotItem) => {
    update({
      slot_iso:     s.startIso,
      teacher_id:   s.teacherId,
      teacher_name: s.teacherName,
    });
    setSelectedSlot(s);
    setShowForm(false);
    setCheckingAvailability(true);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }

    // Lead que vino del quiz `/diagnostico` — auto-submit directo.
    if (isFromDiagnostico) {
      if (submitting) return;
      setSubmitting(true);
      setSubmitErr(null);
      try {
        const whatsapp_e164 = normalizePhone(
          `${state.country_code} ${state.phone_local}`,
          (state.country_code ?? "+49").replace("+", ""),
        );
        const res = await fetch("/api/public/book-trial", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:          state.name!.trim(),
            email:         state.email!.trim().toLowerCase(),
            whatsapp_e164,
            whatsapp_raw:  `${state.country_code} ${state.phone_local}`,
            german_level:  state.german_level,
            goal:          state.goal,
            language:      lang,
            slot_iso:      s.startIso,
            teacher_id:    s.teacherId,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setSubmitErr(json.error ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
          setSubmitting(false);
          return;
        }
        if (!json.classId || !json.token) {
          setSubmitErr("Tu clase se guardó pero no pudimos cargar la confirmación. Mira tu email — te llegará el enlace ahí.");
          setSubmitting(false);
          return;
        }
        if (state.lead_id) firePixelSchedule({ leadId: state.lead_id });
        try { sessionStorage.removeItem("b2c.agendar.v1"); } catch { /* ignore */ }
        if (typeof window !== "undefined") {
          const params = new URLSearchParams({ c: json.classId, t: json.token });
          window.location.href = `/confirmacion?${params.toString()}`;
        }
      } catch (e) {
        console.error("[agendar/cuando] direct submit failed:", e);
        setSubmitErr("Error de conexión. Inténtalo de nuevo.");
        setSubmitting(false);
      }
      return;
    }

    // Atajo desde landing — animación de "comprobando disponibilidad"
    // antes de mostrar el form inline.
    setTimeout(() => {
      setCheckingAvailability(false);
      setShowForm(true);
    }, 2200);
  };

  // Validación form inline.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const nameValid  = form.name.trim().length >= 2;
  const phoneInfo  = useMemo(() => {
    const digits = form.whatsapp.replace(/\D/g, "");
    if (digits.length === 0) return { state: "empty" as const };
    if (digits.length < 6)   return { state: "short" as const };
    const res = resolvePhone(form.countryCode, form.whatsapp);
    if (res.ccMismatch && res.detectedCc) {
      return { state: "mismatch" as const, detectedCc: res.detectedCc, e164: res.e164 };
    }
    if (!res.valid) return { state: "invalid" as const };
    return { state: "ok" as const, e164: res.e164 };
  }, [form.countryCode, form.whatsapp]);
  const phoneError =
    phoneInfo.state === "short"   ? "El número parece muy corto."
    : phoneInfo.state === "invalid" ? "Número no válido. Revisa el prefijo y los dígitos."
    : null;
  const phoneOk    = phoneInfo.state === "ok" || phoneInfo.state === "mismatch";
  const canSubmitForm = nameValid && emailValid && phoneOk && !!selectedSlot && !submitting;

  const submitInlineForm = async () => {
    if (!selectedSlot || !canSubmitForm) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const cc = form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`;
      const whatsapp_e164 = combineE164(form.countryCode, form.whatsapp);
      const whatsapp_raw  = `${cc} ${form.whatsapp}`;
      const res = await fetch("/api/public/book-trial", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:          form.name.trim(),
          email:         form.email.trim().toLowerCase(),
          whatsapp_e164,
          whatsapp_raw,
          german_level:  "A0",
          goal:          "work",
          language:      lang,
          slot_iso:      selectedSlot.startIso,
          teacher_id:    selectedSlot.teacherId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (res.status === 409 && json.error === "slot_taken") {
          setSubmitErr("Ese horario se acaba de ocupar. Elige otro.");
          setSelectedSlot(null);
          fetch("/api/public/trial-slots", { cache: "no-store" })
            .then(r => r.json())
            .then(d => setSlots(d.slots ?? []))
            .catch(() => { /* ignore */ });
        } else {
          setSubmitErr(json.error ?? json.message ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
        }
        setSubmitting(false);
        return;
      }
      if (!json.classId || !json.token) {
        setSubmitErr("Tu clase se guardó pero no pudimos cargar la confirmación. Mira tu email — te llegará el enlace ahí.");
        setSubmitting(false);
        return;
      }
      if (json.leadId) {
        firePixelLead({
          leadId:      json.leadId,
          email:       form.email.trim().toLowerCase(),
          budget:      null,
          hasWhatsapp: true,
        });
        firePixelSchedule({ leadId: json.leadId });
      }
      try { sessionStorage.removeItem("b2c.agendar.v1"); } catch { /* ignore */ }
      if (typeof window !== "undefined") {
        const params = new URLSearchParams({ c: json.classId, t: json.token });
        window.location.href = `/confirmacion?${params.toString()}`;
      }
    } catch (e) {
      console.error("[agendar/cuando] inline submit failed:", e);
      setSubmitErr("Error de conexión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  // Label del slot seleccionado en la TZ del lead.
  const slotLabel = (() => {
    if (!selectedSlot) return null;
    const dt = new Date(selectedSlot.startIso);
    const day = dt.toLocaleDateString("es-ES", {
      timeZone: displayTz, weekday: "long", day: "numeric", month: "long",
    });
    const time = dt.toLocaleTimeString("es-ES", {
      timeZone: displayTz, hour: "2-digit", minute: "2-digit",
    });
    const berlinTime = dt.toLocaleTimeString("es-ES", {
      timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
    });
    return { day, time, berlinTime };
  })();

  return (
    <StepFrame
      title="Tu clase de alemán de prueba"
      subtitle="100% gratis · 45 min con profesor nativo · online · sin compromiso"
    >
      {/* Loading skeleton */}
      {slots === null && !loadErr && (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 w-14 h-[68px] rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
          <div className="space-y-2 mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {loadErr && <p className="text-sm text-red-600">{loadErr}</p>}

      {submitting && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3
                        text-sm text-slate-700 flex items-center gap-3 mb-4">
          <span className="inline-block h-4 w-4 rounded-full border-2 border-warm border-t-transparent animate-spin" aria-hidden />
          Confirmando tu clase…
        </div>
      )}
      {submitErr && (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
          {submitErr}
        </div>
      )}

      {slots && slots.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te
          avisamos en cuanto se abran horarios.
        </div>
      )}

      {slots && slots.length > 0 && (
        <div className="space-y-5">
          {/* Calendario — se colapsa tras seleccionar slot para que el form se vea limpio */}
          {!selectedSlot && (
            <>
              {showDualTz && (
                <div className="rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2.5">
                  <p className="text-[13px] text-sky-900 leading-snug">
                    🌎 Detectamos que estás en <strong>{leadTimezone}</strong>. Te mostramos los horarios en <strong>tu zona</strong> y al lado la hora del profesor en <strong>Berlín</strong>.
                  </p>
                </div>
              )}

              <MobileDayStrip
                daysWithSlots={daysWithSlots}
                selectedDay={selectedDay}
                onSelect={setDay}
                lightMode
                displayTimezone={displayTz}
              />

              {selectedDay && (
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-500 tracking-wider mb-2 capitalize">
                    {fullDateLabel(selectedDay)}
                  </p>
                  <TimeList
                    slots={slotsToday}
                    selectedIso={state.slot_iso ?? null}
                    selectedTeacherId={state.teacher_id ?? null}
                    onSelect={onPickSlot}
                    lightMode
                    leadTimezone={leadTimezone}
                  />
                </div>
              )}
            </>
          )}

          {/* Animación de "comprobando disponibilidad" */}
          {selectedSlot && checkingAvailability && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4 animate-fade-in">
              <div className="relative h-14 w-14">
                <span className="absolute inset-0 rounded-full border-4 border-emerald-200" />
                <span className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                <span className="absolute inset-0 flex items-center justify-center text-2xl">🔍</span>
              </div>
              <p className="text-[15px] font-semibold text-slate-700 text-center">
                Comprobando disponibilidad de los profesores…
              </p>
            </div>
          )}

          {/* Form inline — solo si el lead vino DIRECTO (no del quiz)
              y ya seleccionó slot. Pide los 3 datos mínimos y reserva. */}
          {selectedSlot && showForm && !isFromDiagnostico && slotLabel && !submitting && (
            <button
              type="button"
              onClick={() => { setSelectedSlot(null); setShowForm(false); setCheckingAvailability(false); }}
              className="text-[13px] text-warm font-semibold hover:underline"
            >
              ← Cambiar horario
            </button>
          )}
          {selectedSlot && showForm && !isFromDiagnostico && slotLabel && (
            <div className="mt-2 rounded-2xl border-2 border-warm bg-warm/5 p-4 space-y-4 animate-fade-in">
              <div className="text-center space-y-1">
                <p className="text-[20px] font-extrabold text-slate-900">
                  🎉 <em>Sehr gut!</em>
                </p>
                <p className="text-[15px] text-slate-600">
                  Tenemos todo listo para tu <strong className="text-emerald-700">Clase de Alemán</strong>
                </p>
              </div>

              <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-sky-50 border border-emerald-200 p-4 text-center">
                <p className="mt-1 text-[18px] font-extrabold text-slate-900 capitalize">
                  📅 {slotLabel.day}
                </p>
                <p className="mt-1 text-[22px] font-black text-emerald-700 tabular-nums">
                  🕐 {slotLabel.time}
                </p>
                {showDualTz && (
                  <p className="mt-1 text-[12px] text-slate-500">
                    🇩🇪 {slotLabel.berlinTime} hora de Berlín
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                  Tu nombre <span className="text-warm">*</span>
                </label>
                <input
                  type="text"
                  autoComplete="given-name"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full h-11 px-3.5 rounded-xl bg-white border border-slate-200
                             text-slate-900 placeholder:text-slate-400
                             focus:outline-none focus:border-warm"
                  placeholder="Maria"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                  Email <span className="text-warm">*</span>
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className={`w-full h-11 px-3.5 rounded-xl bg-white border
                             text-slate-900 placeholder:text-slate-400
                             focus:outline-none ${
                               form.email.length > 0 && !emailValid
                                 ? "border-red-400 focus:border-red-500"
                                 : "border-slate-200 focus:border-warm"
                             }`}
                  placeholder="tu@email.com"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                  WhatsApp <span className="text-warm">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    inputMode="tel"
                    value={form.countryCode}
                    onChange={e => setForm(f => ({ ...f, countryCode: e.target.value.replace(/[^0-9+]/g, "") }))}
                    className="w-20 h-11 px-2.5 rounded-xl bg-white border border-slate-200
                               text-slate-900 text-center
                               focus:outline-none focus:border-warm"
                    placeholder="+49"
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                    className={`flex-1 h-11 px-3.5 rounded-xl bg-white border
                               text-slate-900 placeholder:text-slate-400
                               focus:outline-none ${
                                 phoneError
                                   ? "border-red-400 focus:border-red-500"
                                   : "border-slate-200 focus:border-warm"
                               }`}
                    placeholder={phonePlaceholder}
                  />
                </div>
                {phoneError && (
                  <p className="mt-1 text-[12px] text-red-600">{phoneError}</p>
                )}
                <p className="mt-1.5 text-[11.5px] text-slate-500">
                  Te contactaremos solo con <strong>fines educativos</strong>.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!canSubmitForm) return;
                  if (showDualTz) {
                    setPendingConfirmation(true);
                  } else {
                    submitInlineForm();
                  }
                }}
                disabled={!canSubmitForm}
                className="w-full h-12 rounded-2xl bg-warm text-warm-foreground font-bold
                           shadow-lg shadow-warm/20 active:scale-[0.98] transition
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Confirmando…" : "Confirmar mi clase gratis →"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal dual-TZ — solo si la TZ del lead difiere de Berlin.
          Igual que el del CalendarStep en /diagnostico: muestra ambas
          horas en paralelo y exige confirmación explícita antes del
          submit. Cierra el bug de leads LATAM que confundían hora local
          con hora del profe. */}
      {pendingConfirmation && selectedSlot && slotLabel && showDualTz && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => { if (!submitting) setPendingConfirmation(false); }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-extrabold text-slate-900">
              ✅ Confirma el horario
            </h2>
            <p className="mt-1 text-sm text-slate-600 leading-snug">
              Tu clase es en hora de Berlín (donde está el profe). Revisa que coincida con tu agenda local.
            </p>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border-2 border-warm bg-warm/10 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-warm-foreground">
                  🕐 En tu zona ({leadTimezone})
                </p>
                <p className="mt-1 text-[15px] font-bold text-slate-900 capitalize">
                  {slotLabel.day}
                </p>
                <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-tight">
                  {slotLabel.time}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  🇩🇪 En Berlín (zona del profesor)
                </p>
                <p className="text-xl font-bold text-slate-700 tabular-nums leading-tight mt-1">
                  {slotLabel.berlinTime}
                </p>
              </div>
            </div>

            {submitErr && (
              <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                {submitErr}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={submitInlineForm}
                disabled={submitting}
                className="h-12 rounded-2xl bg-warm text-warm-foreground font-bold
                           shadow-lg shadow-warm/20 active:scale-[0.98] transition
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
                    Confirmando…
                  </>
                ) : (
                  "Sí, confirmar reserva"
                )}
              </button>
              <button
                type="button"
                onClick={() => setPendingConfirmation(false)}
                disabled={submitting}
                className="h-11 rounded-2xl border border-slate-200 text-slate-700 font-semibold text-sm
                           hover:bg-slate-50 disabled:opacity-50"
              >
                Cambiar horario
              </button>
            </div>
          </div>
        </div>
      )}
    </StepFrame>
  );
}
