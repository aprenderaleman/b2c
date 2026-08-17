import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyTrialToken } from "@/lib/trial-token";
import { IllustrationPanel } from "@/components/diagnostico/IllustrationPanel";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmacionPixel } from "@/components/confirmacion/ConfirmacionPixel";
import { ConfirmacionDepositPurchase } from "@/components/confirmacion/ConfirmacionDepositPurchase";
import { PriorityUpgradeButton } from "@/components/confirmacion/PriorityUpgradeButton";

/**
 * GET /confirmacion?c={classId}&t={token}
 *
 * Standalone confirmation page tras una reserva exitosa de clase de
 * prueba. Tras el redesign 2026-05-26 usa el mismo layout split-screen
 * (estilo Preply) que el funnel: ilustración a la izquierda + contenido
 * a la derecha. Light mode con paleta brand (warm + amber + emerald).
 *
 * El token es el mismo HMAC-signed magic-link token usado para entrar
 * al aula. Lo verificamos server-side y rechazamos render si está
 * ausente o inválido (redirect a "/").
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Search = { c?: string; t?: string; deposito?: string };

export default async function ConfirmacionPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { c: classId, t: token, deposito } = await searchParams;
  if (!classId || !token) redirect("/");
  const depositoOk = deposito === "ok";

  const payload = verifyTrialToken(token);
  if (!payload || payload.class_id !== classId) redirect("/");

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, lead_id, is_trial, short_code, sesion_closer_id,
      teacher:teachers(users(full_name, email)),
      closer:users!classes_sesion_closer_id_fkey(full_name, email),
      lead:leads!inner(name, email, whatsapp_normalized, reserva_prioritaria)
    `)
    .eq("id", classId)
    .maybeSingle();

  const isSesion = !!(cls as { sesion_closer_id?: string | null } | null)?.sesion_closer_id;
  if (!cls || (!(cls as { is_trial: boolean }).is_trial && !isSesion)) redirect("/");

  type Row = {
    scheduled_at: string;
    duration_minutes: number;
    lead_id: string;
    short_code: string | null;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }> | null;
    closer: { full_name: string | null; email: string } |
            Array<{ full_name: string | null; email: string }> | null;
    lead: { name: string | null; email: string | null; whatsapp_normalized: string | null; reserva_prioritaria: boolean | null } |
          Array<{ name: string | null; email: string | null; whatsapp_normalized: string | null; reserva_prioritaria: boolean | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const r = cls as Row;
  const teacherWrap = flat(r.teacher);
  const tu = teacherWrap ? flat(teacherWrap.users) : null;
  const closerFlat = flat(r.closer);
  const closerName = (closerFlat?.full_name ?? closerFlat?.email ?? "tu asesor/a").split(/\s+/)[0];
  const teacherName = tu?.full_name ?? tu?.email ?? "tu profesor/a";
  const leadFlat    = flat(r.lead);
  const leadName    = leadFlat?.name ?? "";
  const leadEmail   = leadFlat?.email ?? undefined;
  const leadPhone   = leadFlat?.whatsapp_normalized ?? undefined;
  const firstName   = leadName.trim().split(/\s+/)[0] || "";
  const priorityActive = leadFlat?.reserva_prioritaria === true;

  const startDate = new Date(r.scheduled_at).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  });

  return (
    <div className="min-h-[100dvh] bg-white text-slate-900"
         style={{ overscrollBehavior: "contain" }}>
      {/* Google Ads conversion tracker — se dispara al montar, con
          transaction_id=classId para dedup nativa. */}
      {/* Pixels de conversión: trials Y Sesiones de Plan (go de Gelfis
          2026-08-17 para lanzar campañas del funnel /sesion-plan).
          Mismo evento Schedule con dedup por classId; el Purchase del
          depósito sigue siendo solo de trials. */}
      <ConfirmacionPixel classId={classId} leadEmail={leadEmail} leadPhone={leadPhone} />
      {/* Reserva Prioritaria: si volvemos de Stripe con ?deposito=ok,
          dispara Purchase por los 3 canales (Google + fbq + CAPI).
          NO se solapa con ConfirmacionPixel — cada uno tiene su propio
          eventID y sessionStorage guard. */}
      {!isSesion && <ConfirmacionDepositPurchase
        classId={classId}
        leadEmail={leadEmail}
        leadPhone={leadPhone}
        active={depositoOk}
      />}
      <IllustrationPanel step="success">
        <div className="flex flex-col min-h-[100dvh]">
          {/* Header sticky — sólo brand + back a inicio, sin progress bar. */}
          <header
            className="sticky top-0 z-40 backdrop-blur bg-white/95 border-b border-slate-100"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="mx-auto max-w-xl flex items-center justify-between gap-2 h-14 md:h-16 px-4">
              <Link
                href="/"
                aria-label="Volver al inicio"
                className="h-10 w-10 inline-flex items-center justify-center rounded-full
                           text-slate-700 hover:bg-slate-100 active:scale-95 transition"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>

              <BrandLogo size="md" />

              <div className="h-10 w-10" />
            </div>
          </header>

          <main className="flex-1 mx-auto w-full max-w-lg px-5 md:px-8 pt-6 md:pt-12 pb-10 md:pb-16">
            {/* ═══ Banner de prioridad — hero celebratorio (Gelfis
                2026-07-24). Cuando el lead ya pagó (o acaba de volver
                de Stripe), este banner es lo PRIMERO que ve, arriba
                del H1. Cuando no ha pagado, no se muestra y la sección
                normal "Mejora a Reserva Prioritaria" aparece bajo el
                summary con el botón. ═══ */}
            {!isSesion && (priorityActive || depositoOk) && (
              <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-br from-emerald-50 via-emerald-100 to-teal-50 p-4 md:p-5 shadow-lg shadow-emerald-500/15 mb-5">
                <div className="flex items-center gap-3 md:gap-4">
                  <span className="text-4xl md:text-5xl leading-none shrink-0" aria-hidden>🌟</span>
                  <div className="min-w-0">
                    <p className="text-[11px] md:text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-800 flex items-center gap-1.5">
                      Reserva Prioritaria
                      <span className="inline-flex items-center rounded-full bg-amber-400 text-amber-950 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wider shadow-sm">
                        VIP
                      </span>
                    </p>
                    <p className="mt-0.5 text-[20px] md:text-[24px] font-extrabold text-emerald-900 leading-tight">
                      ¡Prioridad activada!
                    </p>
                  </div>
                </div>
                <p className="mt-2.5 text-[14px] md:text-[15px] text-emerald-900 leading-snug">
                  Tu plaza está asegurada. Los <strong>10€</strong> se descuentan de tu pack si decides continuar.
                </p>
              </div>
            )}

            {/* Eyebrow + H1 + subtítulo minimal */}
            <p className="text-[11.5px] md:text-[12px] font-bold uppercase tracking-[0.18em] text-emerald-700">
              ✓ Reserva confirmada
            </p>
            <h1 className="mt-1.5 text-[26px] sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              ¡Todo listo{firstName ? `, ${firstName}` : ""}!
            </h1>
            {isSesion ? (
              <p className="mt-2.5 text-[15px] md:text-[16px] text-slate-600 leading-relaxed">
                Tu <strong className="text-slate-900">Sesión de Plan</strong> con <strong className="text-slate-900">{closerName}</strong> está reservada: 20 minutos por videollamada para armar tu plan de alemán. <strong className="text-slate-900">Revisa tu correo electrónico</strong>, ahí te enviamos el enlace para unirte.
              </p>
            ) : (
              <p className="mt-2.5 text-[15px] md:text-[16px] text-slate-600 leading-relaxed">
                Tu clase de prueba con el/la profesor/a <strong className="text-slate-900">{teacherName}</strong> está reservada, <strong className="text-slate-900">revisa tu correo electrónico</strong>, ahí te enviamos toda la información para unirte a tu clase de alemán.
              </p>
            )}

            {/* Summary card — info clave (fecha/hora + duración). */}
            <div className="mt-5 rounded-2xl bg-gradient-to-br from-slate-50 to-white border border-slate-200 shadow-sm px-5 py-4">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Cuándo
              </p>
              <p className="mt-1 text-[18px] md:text-[20px] font-bold text-slate-900 capitalize leading-snug">
                {startDate}
              </p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">
                Hora de Berlín · {r.duration_minutes ?? 40} min
              </p>
            </div>

            {/* ═══ Reserva Prioritaria — CTA para upgrade opcional.
                Solo se muestra cuando el lead NO ha pagado aún; el
                estado "activada" se muestra como banner celebratorio
                arriba del H1 (ver bloque anterior). ═══ */}
            {!isSesion && !(priorityActive || depositoOk) && (
              <section className="mt-6 rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4 md:p-5">
                <h2 className="text-[16px] md:text-[17px] font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                  <span aria-hidden>🌟</span>
                  <span>Mejora a Reserva Prioritaria</span>
                  <span className="inline-flex items-center rounded-full bg-amber-400 text-amber-950 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider shadow-sm">
                    VIP
                  </span>
                </h2>
                <p className="mt-2 text-[14px] md:text-[15px] text-slate-700 leading-relaxed">
                  Tu profesor preparará la clase <strong>adaptada a tu objetivo</strong> y tu plaza queda asegurada con prioridad. Además, tus <strong>10€ se descuentan de tu pack</strong> si decides continuar.
                </p>
                <div className="mt-4">
                  <PriorityUpgradeButton classId={classId} token={token} />
                </div>
              </section>
            )}

            {/* Volver al inicio — subtle, no primary action */}
            <div className="mt-10 text-center">
              <Link
                href="/"
                className="text-sm text-slate-400 hover:text-slate-700 transition-colors"
              >
                ← Volver al inicio
              </Link>
            </div>
          </main>
        </div>
      </IllustrationPanel>
    </div>
  );
}

function SummaryRow({ k, v, cap = false }: { k: string; v: string; cap?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 w-20 shrink-0">
        {k}
      </span>
      <span className={`text-[14px] md:text-sm font-medium text-slate-900 ${cap ? "capitalize" : ""}`}>
        {v}
      </span>
    </div>
  );
}
