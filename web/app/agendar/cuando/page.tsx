"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { StepFrame, useSetIllustration } from "@/components/agendar/FunnelShell";
import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { useBookingState } from "@/lib/booking-state";
import { useLang } from "@/lib/lang-context";
import { normalizePhone, resolvePhone } from "@/lib/phone";
import { combineE164 } from "@/components/diagnostico/DiagnosticoFunnel";
import { firePixelLead, firePixelSchedule, firePixelScheduleGoogle } from "@/lib/pixels";
import { detectBrowserTimezone, detectCountryFromBrowser, effectiveLeadTimezone } from "@/lib/timezone-country";
import { captureAttributionFromUrl, readAttribution, clearAttribution } from "@/lib/ads-attribution";

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

/**
 * Helpers de estilo del form inline (rediseño moderno limpio
 * estilo Stripe/Linear). Sacados aquí para no repetir clases
 * largas por cada input.
 *
 * `inputCls(valid, error)` devuelve las clases del input según
 * estado: error (rojo), valid (verde sutil), default (slate).
 *
 * `Field` componente wrap con label + helper + error + check verde
 * inline cuando el valor es válido. El check da feedback visible
 * sin necesidad de leer el botón de submit.
 */
function inputCls(valid: boolean, error: boolean): string {
  const base = "w-full h-12 px-4 rounded-xl bg-slate-50 text-slate-900 text-[16px] " +
               "placeholder:text-slate-400 ring-1 ring-inset transition " +
               "focus:outline-none focus:ring-2 focus:bg-white";
  if (error) return `${base} ring-red-300 focus:ring-red-500`;
  if (valid) return `${base} ring-emerald-300 focus:ring-emerald-500`;
  return `${base} ring-slate-200 focus:ring-emerald-500`;
}

function Field({
  label, required, valid, helper, error, children,
}: {
  label:    string;
  required?: boolean;
  valid?:    boolean;
  helper?:   React.ReactNode;
  error?:    string | null;
  children:  React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[15px] font-medium text-slate-900">
          {label}
        </label>
        <span className="text-[12px] text-slate-400 flex items-center gap-1.5">
          {valid && (
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-emerald-500" aria-hidden>
              <path d="M5 10.5 L8.5 14 L15 7" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {required ? "requerido" : "opcional"}
        </span>
      </div>
      {children}
      {error && (
        <p className="mt-1.5 text-[12.5px] text-red-600">{error}</p>
      )}
      {!error && helper && (
        <p className="mt-1.5 text-[12.5px] text-slate-500 leading-relaxed">{helper}</p>
      )}
    </div>
  );
}

/**
 * Wrapper con Suspense — necesario porque StepCuandoInner usa
 * `useSearchParams()`, que en Next 15 fuerza un CSR bailout en
 * prerender y exige un boundary explícito (ver build error
 * "useSearchParams() should be wrapped in a suspense boundary").
 */
export default function StepCuando() {
  return (
    <Suspense fallback={null}>
      <StepCuandoInner />
    </Suspense>
  );
}

// Depósito Stripe eliminado 2026-07-10 (Gelfis): el lead va directo
// a /confirmacion tras submit sin paso intermedio. STRIPE_DEPOSIT_URL,
// showDepositRedirect y la pantalla intermedia se retiraron.

function StepCuandoInner() {
  const router = useRouter();
  const { lang } = useLang();
  const { state, update, hydrated } = useBookingState();

  // Atribución desde URL (Gelfis 2026-06-15). La home `/` redirige aquí
  // tras paso 2 (nivel) con `?landing=socialmedia&motivo=X&level=Y`.
  // El CTA de las landings dedicadas no añade params (default a
  // 'agendar-directo'). Cualquier valor adicional simplemente se pasa
  // al body de book-trial y se persiste en leads.landing_intent.
  const searchParams = useSearchParams();
  const landingFromUrl = searchParams?.get("landing") ?? null;
  const motivoFromUrl  = searchParams?.get("motivo")  ?? null;
  const levelFromUrl   = searchParams?.get("level")   ?? null;
  // Si el lead viene del flujo /home con socialmedia, ya nos dieron
  // motivo + nivel. Si no, asumimos atajo desde landing.
  const effectiveLanding = landingFromUrl ?? "agendar-directo";

  // Captura gclid/utm de URL al montar. Si el lead vino directo aquí
  // con ?gclid=... (Google Ads), lo persistimos para spread en book-trial.
  // Si vino redirigido desde /diagnostico o landing, ya está en sessionStorage
  // y captureAttributionFromUrl es idempotente (no pisa).
  useEffect(() => { captureAttributionFromUrl(); }, []);

  const [slots,    setSlots]    = useState<SlotItem[] | null>(null);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [selectedDay, setDay]   = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // Cambia la ilustración del shell mientras el lead rellena el form
  // (antes era la misma del calendario, era confuso).
  const setIllustration = useSetIllustration();
  useEffect(() => {
    setIllustration(showForm ? "formulario" : null);
    return () => setIllustration(null);
  }, [showForm, setIllustration]);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  // Modal de doble confirmación dual-TZ. Igual que el CalendarStep
  // del DiagnosticoFunnel — exige confirmación extra cuando la TZ del
  // lead difiere de Berlin (caso recurrente: LATAM se presentaba a
  // su hora local).
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  // TZ del navegador (detectada al montar). Puede ser engañosa: VPN,
  // in-app browsers, Brave/Firefox con privacidad agresiva → null,
  // UTC o Berlin. Por eso la combinamos con el prefijo WhatsApp más
  // abajo en `leadTimezone`.
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  useEffect(() => { setBrowserTz(detectBrowserTimezone()); }, []);

  // Form inline (atajo desde landing). WhatsApp re-introducido 2026-06-26
  // (Gelfis) — obligatorio, después del nivel. Email sigue siendo el
  // canal principal de confirmación, pero queremos WA por si email
  // falla o el lead prefiere ese canal.
  const [form, setForm] = useState({
    name: "", email: "",
    germanLevel: null as null | "A0" | "A1" | "A2" | "B1" | "B2" | "C1",
    whatsapp: "", countryCode: "+49",
    commitment: false,
  });

  // TZ efectiva del lead — combina browser + prefijo WA. Si el
  // navegador miente (Berlin/UTC genérico) pero el prefijo es +51,
  // sabemos que está en Perú y activamos dual-TZ. Caso Martin 2026-06-17.
  const leadTimezone = effectiveLeadTimezone({
    browserTimezone: browserTz,
    whatsappPrefix:  form.countryCode,
  });
  const displayTz = leadTimezone ?? "Europe/Berlin";
  const showDualTz = !!leadTimezone && leadTimezone !== "Europe/Berlin";
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
            ...readAttribution(),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setSubmitErr(json.message ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
          setSubmitting(false);
          return;
        }
        if (!json.classId || !json.token) {
          setSubmitErr("Tu clase se guardó pero no pudimos cargar la confirmación. Mira tu email — te llegará el enlace ahí.");
          setSubmitting(false);
          return;
        }
        if (state.lead_id) firePixelSchedule({ leadId: state.lead_id });
        // Google Ads conversion PRIMARIA — antes del redirect a Stripe.
        firePixelScheduleGoogle({ classId: json.classId });
        try { sessionStorage.removeItem("b2c.agendar.v1"); } catch { /* ignore */ }
        if (typeof window !== "undefined") {
          const params = new URLSearchParams({ c: json.classId, t: json.token });
          window.location.href = `/confirmacion?${params.toString()}`;
        }
        return;
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

  // Validación form inline (WhatsApp obligatorio desde 2026-06-26).
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
  const canSubmitForm = nameValid && emailValid && phoneOk && form.commitment && !!selectedSlot && !submitting;

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
          german_level:  form.germanLevel ?? levelFromUrl ?? "A0",
          goal:          "work",
          language:      lang,
          slot_iso:      selectedSlot.startIso,
          teacher_id:    selectedSlot.teacherId,
          // Atribución a /admin/ads. Si la URL trae ?landing=socialmedia
          // (home redirige aquí tras paso 2), usamos eso y el motivo
          // real elegido en home. Si no, atajo desde landing dedicada
          // ('agendar-directo') y book-trial marcará motivo='direct'.
          landing_intent: effectiveLanding,
          ...(motivoFromUrl ? { motivo_inicial: motivoFromUrl } : {}),
          ...readAttribution(),
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
          setSubmitErr(json.message ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
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
      // Google Ads conversion — se dispara AL confirmar datos con
      // transaction_id=classId para dedup nativa (Gelfis 2026-06-30).
      firePixelScheduleGoogle({ classId: json.classId });
      try { sessionStorage.removeItem("b2c.agendar.v1"); } catch { /* ignore */ }
      // Atribución consumida → limpiar para que el próximo visitante
      // no herede el gclid de este lead.
      clearAttribution();
      // Redirect directo a /confirmacion (sin paso Stripe intermedio
      // desde 2026-07-10 — depósito eliminado).
      if (typeof window !== "undefined") {
        const params = new URLSearchParams({ c: json.classId, t: json.token });
        window.location.href = `/confirmacion?${params.toString()}`;
      }
      return;
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

  // Pantalla intermedia de depósito Stripe eliminada 2026-07-10:
  // el submit ahora navega directo a /confirmacion.

  return (
    <StepFrame
      title={
        showForm ? (
          <>
            <em className="italic">Fast geschafft!</em> <span className="text-slate-500 font-normal">(¡Ya casi!)</span> 🎉
          </>
        ) : (
          "Selecciona fecha y hora para clase de Alemán"
        )
      }
      subtitle={
        showForm
          ? "El alemán te abre las puertas a los mejores salarios y la mejor calidad de vida de Europa."
          : "30 min con profesor nativo + diagnóstico de nivel + plan de estudios personalizado"
      }
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
            <div className="mt-2 rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-slate-100 p-5 md:p-6 space-y-6 animate-fade-in">
              {/* Header sobrio — sin emoji gigante */}
              <div className="space-y-1.5">
                <p className="text-[13px] font-semibold uppercase tracking-wider text-emerald-600">
                  Casi listo
                </p>
                <h2 className="text-[22px] md:text-[26px] font-bold text-slate-900 leading-tight tracking-tight">
                  Confirma tus datos
                </h2>
              </div>

              {/* Slot card — tipografía más limpia, un solo emoji */}
              <div className="rounded-2xl bg-emerald-50/60 border border-emerald-100 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/80">
                  Tu clase de prueba
                </p>
                <p className="mt-1.5 text-[17px] font-semibold text-slate-900 capitalize leading-tight">
                  {slotLabel.day}
                </p>
                <p className="mt-0.5 text-[24px] font-bold text-emerald-700 tabular-nums leading-tight">
                  {slotLabel.time}
                </p>
                {showDualTz && (
                  <p className="mt-1.5 text-[12.5px] text-slate-500">
                    En Berlín: <span className="font-medium text-slate-700">{slotLabel.berlinTime}</span>
                  </p>
                )}
              </div>

              {/* ── Nombre ── */}
              <Field
                label="Tu nombre"
                required
                valid={nameValid}
              >
                <input
                  type="text"
                  autoComplete="given-name"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls(nameValid && form.name.length > 0, false)}
                  placeholder="Maria"
                />
              </Field>

              {/* ── Email ── */}
              <Field
                label="Email"
                required
                valid={emailValid && form.email.length > 0}
                helper={<>Después de confirmar, <strong className="text-slate-700">revisa tu correo</strong> — te llegan los detalles y el botón para confirmar.</>}
              >
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className={inputCls(emailValid && form.email.length > 0, form.email.length > 0 && !emailValid)}
                  placeholder="tu@email.com"
                />
              </Field>

              {/* ── Nivel (opcional) ── */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="text-[15px] font-medium text-slate-900">
                    Tu nivel de alemán
                  </label>
                  <span className="text-[12px] text-slate-400">opcional</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {(["A0","A1","A2","B1","B2","C1"] as const).map(lvl => {
                    const active = form.germanLevel === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, germanLevel: active ? null : lvl }))}
                        className={`h-12 rounded-xl font-semibold text-[15px] transition active:scale-[0.97]
                                    ${active
                                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25"
                                      : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"}`}
                        aria-pressed={active}
                      >
                        {lvl}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[12.5px] text-slate-500 leading-relaxed">
                  A0 = empiezas de cero · C1 = ya hablas con fluidez. Si dudas, déjalo en blanco.
                </p>
              </div>

              {/* ── WhatsApp ── */}
              <Field
                label="WhatsApp"
                required
                valid={phoneInfo.state === "ok"}
                helper="Te contactaremos solo con fines educativos."
                error={phoneError}
              >
                <div className="flex gap-2">
                  <input
                    type="tel"
                    inputMode="tel"
                    value={form.countryCode}
                    onChange={e => setForm(f => ({ ...f, countryCode: e.target.value.replace(/[^0-9+]/g, "") }))}
                    className="w-[88px] h-12 px-3 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200
                               text-slate-900 text-[16px] text-center font-medium
                               focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
                    placeholder="+49"
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                    className={`flex-1 ${inputCls(phoneOk && phoneInfo.state !== "mismatch", !!phoneError)}`}
                    placeholder={phonePlaceholder}
                  />
                </div>
                {/* Aviso ccMismatch — libphonenumber detectó que el número
                    tecleado pertenece a otro país. No bloquea, pero ofrece
                    auto-corrección con 1 clic. Previene casos como Maria
                    que escribe su número peruano con el +49 default. */}
                {phoneInfo.state === "mismatch" && phoneInfo.detectedCc && (
                  <div className="mt-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 flex items-start gap-2.5">
                    <span className="text-[18px] leading-none shrink-0" aria-hidden>⚠️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-amber-900 leading-snug">
                        Tu número parece de <strong>{phoneInfo.detectedCc}</strong> pero seleccionaste <strong>{form.countryCode}</strong>.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => phoneInfo.detectedCc && setForm(f => ({ ...f, countryCode: phoneInfo.detectedCc as string }))}
                          className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[12.5px] font-semibold transition"
                        >
                          Usar {phoneInfo.detectedCc}
                        </button>
                        <button
                          type="button"
                          onClick={() => phoneInfo.e164 && setForm(f => ({ ...f, whatsapp: "" }))}
                          className="h-8 px-3 rounded-lg bg-white ring-1 ring-amber-200 text-amber-900 text-[12.5px] font-semibold hover:bg-amber-50 transition"
                        >
                          Corregir manualmente
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Field>

              {/* Bloque "🔒 Asegura tu plaza con 10€" oculto por
                  petición de Gelfis 2026-07-05. La lógica de redirect
                  a Stripe tras submit sigue activa — solo se oculta la
                  UI que explicaba el depósito al lead antes de enviar.
                  Restaurar copiando el bloque del commit 2f870fc. */}

              {/* ── Compromiso ── */}
              <label className="flex items-start gap-3 cursor-pointer select-none rounded-2xl bg-slate-50 hover:bg-slate-100/80 p-4 transition">
                <input
                  type="checkbox"
                  checked={form.commitment}
                  onChange={e => setForm(f => ({ ...f, commitment: e.target.checked }))}
                  className="mt-0.5 h-5 w-5 accent-emerald-600 shrink-0 cursor-pointer"
                />
                <span className="text-[14px] text-slate-700 leading-relaxed">
                  Reservo este espacio con la intención real de aprender alemán. Me comprometo a asistir puntualmente a mi clase.
                </span>
              </label>

              {/* ── CTA ── */}
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
                className="w-full h-13 min-h-[52px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white
                           text-[16px] font-semibold tracking-wide
                           shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition
                           disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 disabled:shadow-none"
              >
                {submitting ? "Confirmando…" : "Confirmar"}
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
