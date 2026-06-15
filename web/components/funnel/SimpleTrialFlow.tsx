"use client";

/**
 * SimpleTrialFlow — funnel de reserva de clase de prueba de 2 pasos.
 *
 * Decisión Gelfis 2026-06-15: el quiz de 4 preguntas (motivo / nivel /
 * goal / urgencia) era demasiado largo y se cargaba la conversión. El
 * 95 % de los leads quieren lo mismo (una clase de prueba), preguntarles
 * eso por adelantado solo añade fricción. Mantenemos UNA pregunta de
 * cualificación útil (nivel) y vamos directos al calendario.
 *
 * Flujo:
 *   Paso 1 — "¿Cuál es tu nivel actual de alemán?" (6 opciones MCER)
 *   Paso 2 — calendario integrado:
 *              · calendario (dual-TZ)
 *              · al seleccionar slot → colapsa a resumen
 *              · checkbox de compromiso
 *              · al marcar → desplegamos form (nombre+email+WA)
 *              · submit → /confirmacion
 *
 * Usado por:
 *   - app/page.tsx (home /)
 *   - components/landings/LandingStep0.tsx (tras click "Reservar")
 *   - app/agendar/cuando/page.tsx
 *
 * Tracking:
 *   - presetMotivo y landingIntent se propagan al register para que
 *     /admin/ads pueda hacer breakdown por origen (los necesitábamos
 *     antes para el desglose por landing).
 *   - firePixelLead + firePixelSchedule al confirmar reserva.
 *   - Google Ads "Schedule" conversion la dispara <ConfirmacionPixel />
 *     en /confirmacion para deduplicación por classId.
 */

import { useEffect, useMemo, useState } from "react";
import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { combineE164, resolvePhone } from "@/lib/phone";
import { firePixelLead, firePixelSchedule } from "@/lib/pixels";
import { detectBrowserTimezone, detectCountryFromBrowser } from "@/lib/timezone-country";

// ── Niveles MCER — sincronizado con LEVEL_OPTIONS del endpoint
//    /api/public/diagnostico/register. `answerString` es el string EXACTO
//    que el endpoint espera (validación zod estricta). ──
type LevelId = "A0" | "A1" | "A2" | "B1" | "B2" | "C1";

const LEVEL_OPTIONS: Array<{ id: LevelId; title: string; emoji: string; answerString: string }> = [
  { id: "A0", title: "Cero, no sé nada",                      emoji: "🌱", answerString: "A0 — Cero, no sé nada" },
  { id: "A1", title: "Conozco lo básico (saludos, números)",  emoji: "🙂", answerString: "A1 — Conozco lo básico (saludos, números)" },
  { id: "A2", title: "Conversaciones simples del día a día",  emoji: "💬", answerString: "A2 — Conversaciones simples del día a día" },
  { id: "B1", title: "Hablo de temas cotidianos con fluidez", emoji: "🗣️", answerString: "B1 — Hablo de temas cotidianos con fluidez" },
  { id: "B2", title: "Me defiendo en contextos exigentes",    emoji: "💼", answerString: "B2 — Me defiendo en contextos exigentes" },
  { id: "C1", title: "Nivel avanzado",                        emoji: "🎓", answerString: "C1 — Nivel avanzado" },
];

const LEVEL_ANSWER_STRING: Record<LevelId, string> = Object.fromEntries(
  LEVEL_OPTIONS.map(o => [o.id, o.answerString]),
) as Record<LevelId, string>;

// Set válido de motivos para el endpoint (zod enum). Cualquier otro
// valor se manda como null para no romper el register.
const VALID_MOTIVOS = new Set<string>(["particulares", "intensivo", "certificado", "profesional"]);

type Props = {
  /** Slug de la landing — se manda al register para tracking. */
  landingIntent?: string;
  /** Motivo preseleccionado (p.ej. la landing /clases-aleman-ciudades
   * fija "particulares"). Se manda al register para tracking. */
  presetMotivo?: string | null;
};

export function SimpleTrialFlow({
  landingIntent = "home",
  presetMotivo  = null,
}: Props = {}) {
  // step state — 1 = nivel, 2 = calendar+form
  const [step, setStep] = useState<1 | 2>(1);
  const [level, setLevel] = useState<LevelId | null>(null);

  const onPickLevel = (lvl: LevelId) => {
    setLevel(lvl);
    setStep(2);
    // Telemetría — el siguiente paso ya tiene un nivel asociado
    if (typeof window !== "undefined") {
      try {
        const sid = sessionStorage.getItem("b2c.diagnostico.sid") ?? null;
        if (sid) {
          fetch("/api/public/funnel/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, step: 2, answer: lvl }),
            keepalive: true,
          }).catch(() => { /* silent */ });
        }
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white text-slate-900">
      {step === 1 && <LevelStep onPick={onPickLevel} />}
      {step === 2 && level && (
        <CalendarAndDataStep
          level={level}
          landingIntent={landingIntent}
          presetMotivo={presetMotivo}
          onBack={() => setStep(1)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// PASO 1 — nivel
// ──────────────────────────────────────────────────────────────────

function LevelStep({ onPick }: { onPick: (lvl: LevelId) => void }) {
  return (
    <div className="px-5 pt-8 pb-12 mx-auto max-w-xl">
      <p className="text-[14px] md:text-[15px] text-warm-foreground font-semibold">
        Genial 👋 Tu primera clase con un profesor nativo certificado es gratis
      </p>
      <h1 className="mt-3 text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900 leading-tight">
        ¿Cuál es tu nivel actual de alemán?
      </h1>

      <div className="mt-6 space-y-2">
        {LEVEL_OPTIONS.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id)}
            className="w-full flex items-center gap-3 rounded-2xl border-2 border-slate-200
                       bg-white px-4 py-3.5 text-left
                       hover:border-warm hover:bg-warm/5 active:scale-[0.99] transition"
          >
            <span className="text-2xl leading-none shrink-0" aria-hidden>{o.emoji}</span>
            <span className="flex-1">
              <span className="block text-[15px] font-bold text-slate-900">{o.id}</span>
              <span className="block text-[13px] text-slate-600 leading-snug">{o.title}</span>
            </span>
            <span className="text-slate-400" aria-hidden>→</span>
          </button>
        ))}
      </div>

      <p className="mt-5 text-[11.5px] text-slate-500 leading-snug text-center">
        ⏱️ Solo 60 segundos · 💳 Sin tarjeta · 🤝 Sin compromiso
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// PASO 2 — calendario + commit + formulario
// ──────────────────────────────────────────────────────────────────

function CalendarAndDataStep({
  level, landingIntent, presetMotivo, onBack,
}: {
  level: LevelId;
  landingIntent: string;
  presetMotivo:  string | null;
  onBack: () => void;
}) {
  const [slots,    setSlots]    = useState<SlotItem[] | null>(null);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [selectedDay,  setDay]   = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [commitAttend, setCommitAttend] = useState(false);
  const [submitting,   setSubmitting] = useState(false);
  const [submitErr,    setSubmitErr] = useState<string | null>(null);

  // TZ del lead — para dual-TZ en calendario y agrupación por día.
  const [leadTimezone, setLeadTimezone] = useState<string | null>(null);
  useEffect(() => { setLeadTimezone(detectBrowserTimezone()); }, []);
  const displayTz  = leadTimezone ?? "Europe/Berlin";
  const showDualTz = !!leadTimezone && leadTimezone !== "Europe/Berlin";

  // Form — auto-detect prefix y placeholder según TZ.
  const [form, setForm] = useState({
    name: "", email: "", whatsapp: "", countryCode: "+49",
  });
  const [phonePlaceholder, setPhonePlaceholder] = useState("15253409644");
  useEffect(() => {
    const det = detectCountryFromBrowser();
    if (!det) return;
    setPhonePlaceholder(det.examplePhone);
    setForm(f => (f.countryCode === "+49" ? { ...f, countryCode: det.countryCode } : f));
  }, []);

  // Carga de slots.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, []);

  // Agrupación por día en TZ del lead.
  const slotsByDay = useMemo(() => {
    const map = new Map<string, SlotItem[]>();
    for (const s of slots ?? []) {
      const key = new Intl.DateTimeFormat("en-CA", {
        timeZone: displayTz, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(s.startIso));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [slots, displayTz]);

  const daysWithSlots = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (!slots || slots.length === 0 || selectedDay) return;
    const firstKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: displayTz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(slots[0].startIso));
    setDay(firstKey);
  }, [slots, selectedDay, displayTz]);

  const slotsToday: SlotItem[] = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  const onPickSlot = (s: SlotItem) => {
    if (submitting) return;
    setSelectedSlot(s);
    setSubmitErr(null);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }
  };

  // Label "viernes 9 de mayo · 17:00" en TZ del lead.
  const slotLabel = useMemo(() => {
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
  }, [selectedSlot, displayTz]);

  const fullDateLabel = (key: string): string => {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    return dt.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  };

  // Validación del form.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const nameValid  = form.name.trim().length >= 2;
  const phoneInfo  = useMemo(() => {
    const digits = form.whatsapp.replace(/\D/g, "");
    if (digits.length === 0) return { state: "empty" as const };
    if (digits.length < 6)   return { state: "short" as const };
    const res = resolvePhone(form.countryCode, form.whatsapp);
    if (res.ccMismatch && res.detectedCc) return { state: "mismatch" as const, detectedCc: res.detectedCc, e164: res.e164 };
    if (!res.valid) return { state: "invalid" as const };
    return { state: "ok" as const, e164: res.e164 };
  }, [form.countryCode, form.whatsapp]);
  const phoneError =
    phoneInfo.state === "short"   ? "El número parece muy corto."
    : phoneInfo.state === "invalid" ? "Número no válido. Revisa el prefijo y los dígitos."
    : null;
  const phoneOk = phoneInfo.state === "ok" || phoneInfo.state === "mismatch";
  const canSubmit = !submitting && nameValid && emailValid && phoneOk && commitAttend && !!selectedSlot;

  const submit = async () => {
    if (!canSubmit || !selectedSlot) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const cc = form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`;
      const whatsapp_e164 = combineE164(form.countryCode, form.whatsapp);
      const whatsapp_raw  = `${cc} ${form.whatsapp}`;

      // 1. Register lead (crea fila en leads). Si ya existe por email,
      //    el endpoint lo upsertea con los datos nuevos.
      const sid = typeof window !== "undefined" ? sessionStorage.getItem("b2c.diagnostico.sid") : null;
      const motivoForBody = presetMotivo && VALID_MOTIVOS.has(presetMotivo) ? presetMotivo : undefined;
      const regRes = await fetch("/api/public/diagnostico/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           form.name.trim(),
          email:          form.email.trim().toLowerCase(),
          whatsapp_e164,
          language:       "es",
          gdpr_accepted:  true,
          ...(sid ? { session_id: sid } : {}),
          ...(motivoForBody ? { motivo_inicial: motivoForBody } : {}),
          landing_intent: landingIntent,
          answers: {
            level: LEVEL_ANSWER_STRING[level],
            // goal / urgencia / budget ya no se preguntan (decisión Gelfis
            // 2026-06-15). Stiv los recoge por WhatsApp post-conversion.
            goal:    null,
            urgency: null,
            budget:  null,
          },
        }),
      });
      const regJson = await regRes.json().catch(() => ({}));
      if (!regRes.ok || !regJson.ok) {
        setSubmitErr(regJson.message ?? regJson.error ?? "No pudimos registrar tu lead. Revisa los datos e inténtalo.");
        setSubmitting(false);
        return;
      }
      const leadId: string | null = regJson.leadId ?? null;

      // Telemetría paso 3 (form completado).
      if (leadId) {
        firePixelLead({
          leadId,
          email: form.email.trim().toLowerCase(),
          budget: null,
          hasWhatsapp: true,
        });
      }

      // 2. Book trial (crea fila en classes + ata al lead).
      const bookRes = await fetch("/api/public/book-trial", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:          form.name.trim(),
          email:         form.email.trim().toLowerCase(),
          whatsapp_e164,
          whatsapp_raw,
          german_level:  level,
          // goal NULLABLE en endpoint (cae a 'travel' por compat); el
          // dashboard ignora null. Está bien.
          goal:          null,
          language:      "es",
          slot_iso:      selectedSlot.startIso,
          teacher_id:    selectedSlot.teacherId,
        }),
      });
      const bookJson = await bookRes.json().catch(() => ({}));
      if (bookRes.status === 409 && bookJson.error === "slot_taken") {
        setSubmitErr("Ese horario se acaba de ocupar. Elige otro.");
        setSelectedSlot(null);
        setCommitAttend(false);
        fetch("/api/public/trial-slots", { cache: "no-store" })
          .then(r => r.json())
          .then(d => setSlots(d.slots ?? []))
          .catch(() => { /* ignore */ });
        setSubmitting(false);
        return;
      }
      if (!bookRes.ok || !bookJson.ok) {
        setSubmitErr(bookJson.message ?? bookJson.error ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }
      if (!bookJson.classId || !bookJson.token) {
        setSubmitErr("Tu clase se guardó pero no pudimos cargar la confirmación. Mira tu email — te llegará el enlace ahí.");
        setSubmitting(false);
        return;
      }

      const finalLeadId: string | null = leadId ?? bookJson.leadId ?? null;
      if (finalLeadId) firePixelSchedule({ leadId: finalLeadId });

      // Telemetría paso 7 (clase agendada).
      try {
        const sid = typeof window !== "undefined" ? sessionStorage.getItem("b2c.diagnostico.sid") : null;
        if (sid) {
          fetch("/api/public/funnel/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, step: 7, answer: selectedSlot.startIso }),
            keepalive: true,
          }).catch(() => { /* silent */ });
        }
      } catch { /* ignore */ }

      // Limpiar storage del flujo.
      try {
        sessionStorage.removeItem("b2c.agendar.v1");
        sessionStorage.removeItem("diagnostico_lead_id");
        sessionStorage.removeItem("diagnostico_name");
        sessionStorage.removeItem("diagnostico_email");
      } catch { /* ignore */ }

      // Redirect a /confirmacion. El gtag conversion lo dispara la
      // página /confirmacion (<ConfirmacionPixel />) usando classId
      // como transaction_id para dedup.
      const params = new URLSearchParams({ c: bookJson.classId, t: bookJson.token });
      window.location.href = `/confirmacion?${params.toString()}`;
    } catch (e) {
      console.error("[SimpleTrialFlow] submit failed:", e);
      setSubmitErr("Error de conexión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="px-5 pt-6 pb-20 mx-auto max-w-xl">
      {/* Back a paso 1 */}
      <button
        type="button"
        onClick={onBack}
        className="text-[13px] text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
      >
        ← Cambiar nivel
      </button>

      <h1 className="mt-3 text-[24px] sm:text-[28px] md:text-[30px] font-extrabold tracking-tight text-slate-900 leading-tight">
        Elige tu horario para la clase de alemán de prueba gratis 🎉
      </h1>

      {/* Si ya hay slot seleccionado, mostramos UN resumen y colapsamos
          el calendario. El lead siempre puede cambiar de horario con
          el botón "Cambiar horario" del resumen. */}
      {selectedSlot && slotLabel ? (
        <div className="mt-5 rounded-2xl border-2 border-warm bg-warm/10 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-warm-foreground">
            🕐 Tu horario seleccionado
          </p>
          <p className="mt-1 text-[16px] md:text-[17px] font-bold text-slate-900 capitalize leading-snug">
            {slotLabel.day} · {slotLabel.time}
            {showDualTz && (
              <span className="ml-2 text-[12px] font-normal text-slate-500">
                ({slotLabel.berlinTime} Berlín)
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedSlot(null);
              setCommitAttend(false);
            }}
            className="mt-2 text-[12px] font-semibold text-warm-foreground underline underline-offset-2"
          >
            Cambiar horario
          </button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[14px] text-slate-600">Selecciona fecha y hora:</p>

          <div className="mt-4">
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

            {slots && slots.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
                Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te avisamos en cuanto se abran horarios.
              </div>
            )}

            {slots && slots.length > 0 && (
              <div className="space-y-5">
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
                      selectedIso={null}
                      selectedTeacherId={null}
                      onSelect={onPickSlot}
                      lightMode
                      leadTimezone={leadTimezone}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Compromiso — aparece SOLO con slot seleccionado. */}
      {selectedSlot && slotLabel && (
        <label className="mt-5 flex items-start gap-3 cursor-pointer rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <input
            type="checkbox"
            checked={commitAttend}
            onChange={e => setCommitAttend(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-warm shrink-0 cursor-pointer"
          />
          <span className="text-[13.5px] md:text-sm text-amber-900 leading-snug">
            Me comprometo a asistir el <strong className="capitalize">{slotLabel.day} a las {slotLabel.time}</strong>{" "}
            o a <strong>cancelar con antelación</strong> si surge un imprevisto.
          </span>
        </label>
      )}

      {/* Form — aparece SOLO tras marcar compromiso. */}
      {selectedSlot && slotLabel && commitAttend && (
        <div className="mt-6 rounded-2xl border-2 border-warm bg-white p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-warm-foreground">
              ✨ Último paso
            </p>
            <h2 className="mt-1 text-[17px] md:text-[18px] font-extrabold text-slate-900 leading-snug">
              Tu clase de alemán es el <span className="capitalize">{slotLabel.day} a las {slotLabel.time}</span>
            </h2>
            <p className="mt-1 text-[13.5px] text-slate-600">
              Solo necesitamos tus datos para preparar la clase contigo.
            </p>
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
              className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200
                         text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:border-warm focus:bg-white"
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
              className={`w-full h-11 px-3.5 rounded-xl bg-slate-50 border
                         text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:bg-white ${
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
                className="w-20 h-11 px-2.5 rounded-xl bg-slate-50 border border-slate-200
                           text-slate-900 text-center
                           focus:outline-none focus:border-warm focus:bg-white"
                placeholder="+49"
              />
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.whatsapp}
                onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                className={`flex-1 h-11 px-3.5 rounded-xl bg-slate-50 border
                           text-slate-900 placeholder:text-slate-400
                           focus:outline-none focus:bg-white ${
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

          {submitErr && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              {submitErr}
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="w-full h-12 rounded-2xl bg-warm text-warm-foreground font-bold
                       shadow-lg shadow-warm/20 active:scale-[0.98] transition
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Confirmando…" : "🎁 Reservar mi clase gratis"}
          </button>
        </div>
      )}
    </div>
  );
}
