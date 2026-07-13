import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyTrialToken } from "@/lib/trial-token";
import { IllustrationPanel } from "@/components/diagnostico/IllustrationPanel";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmacionPixel } from "@/components/confirmacion/ConfirmacionPixel";

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

type Search = { c?: string; t?: string };

export default async function ConfirmacionPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { c: classId, t: token } = await searchParams;
  if (!classId || !token) redirect("/");

  const payload = verifyTrialToken(token);
  if (!payload || payload.class_id !== classId) redirect("/");

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, lead_id, is_trial, short_code,
      teacher:teachers!inner(users!inner(full_name, email)),
      lead:leads!inner(name)
    `)
    .eq("id", classId)
    .maybeSingle();

  if (!cls || !(cls as { is_trial: boolean }).is_trial) redirect("/");

  type Row = {
    scheduled_at: string;
    duration_minutes: number;
    lead_id: string;
    short_code: string | null;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }>;
    lead: { name: string | null } | Array<{ name: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const r = cls as Row;
  const teacherWrap = flat(r.teacher);
  const tu = teacherWrap ? flat(teacherWrap.users) : null;
  const teacherName = tu?.full_name ?? tu?.email ?? "tu profesor/a";
  const leadName    = flat(r.lead)?.name ?? "";
  const firstName   = leadName.trim().split(/\s+/)[0] || "";

  const startDate = new Date(r.scheduled_at).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  });

  // Magic-link corto (matches what salió por email/WhatsApp). Fallback
  // al URL largo si el class no tiene short_code (pre-migration 036).
  const magicLinkUrl = r.short_code
    ? `/c/${r.short_code}`
    : `/trial/${classId}?t=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-[100dvh] bg-white text-slate-900"
         style={{ overscrollBehavior: "contain" }}>
      {/* Google Ads conversion tracker — se dispara al montar, con
          transaction_id=classId para dedup nativa. */}
      <ConfirmacionPixel classId={classId} />
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

          <main className="flex-1 mx-auto w-full max-w-xl px-5 md:px-8 pt-6 md:pt-12 lg:pt-16 pb-12 md:pb-16">
            {/* Eyebrow + título principal */}
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-emerald-700">
              ✓ Reserva confirmada
            </p>
            <h1 className="mt-2 text-[28px] sm:text-3xl md:text-4xl lg:text-[40px] font-extrabold tracking-tight text-slate-900 leading-tight">
              ¡Casi listo{firstName ? `, ${firstName}` : ""}!
            </h1>
            <p className="mt-3 text-[22px] sm:text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
              Revisa tu correo electrónico.
            </p>
            <p className="mt-3 text-[15px] md:text-base text-slate-600 leading-relaxed">
              Revisa tu <strong>correo electrónico</strong> ahora — te acabamos
              de enviar un email con el botón <strong>«Confirmar asistencia»</strong>.
              Un solo clic y tu profesor sabrá que vas a venir.
            </p>

            {/* Bloques de depósito eliminados 2026-07-10. */}

            {/* 📧 Bloque acción principal — confirmar por email */}
            <div className="mt-5 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 md:p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5" aria-hidden>📧</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold uppercase tracking-wider text-emerald-900">
                    Abre tu email y haz clic en «Confirmar»
                  </p>
                  <p className="mt-1.5 text-[14.5px] md:text-[15px] text-emerald-900 leading-snug">
                    Si no lo ves en la bandeja de entrada, revisa <strong>Promociones</strong> o <strong>Spam</strong>. Puede tardar hasta 5 minutos en llegar.
                  </p>
                </div>
              </div>
            </div>

            {/* 💎 Bloque "valor 30 €" — refuerzo de asistencia. Va antes
                del summary para que sea lo primero que vea el lead. */}
            <div className="mt-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 md:p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5" aria-hidden>💎</span>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold uppercase tracking-wider text-amber-900">
                    Tu clase tiene valor de 30 €
                  </p>
                  <p className="mt-1.5 text-[14.5px] md:text-[15px] text-amber-900 leading-snug">
                    Te la regalamos por asistir. Te esperamos
                    el <strong className="capitalize">{startDate}</strong>.
                  </p>
                </div>
              </div>
            </div>

            {/* Booking summary card — datos clave de la reserva */}
            <div className="mt-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-5 md:p-6 space-y-3">
              <SummaryRow k="Fecha"     v={startDate} cap />
              <SummaryRow k="Profesor"  v={teacherName} />
              <SummaryRow k="Duración"  v={`${r.duration_minutes ?? 30} minutos`} />
            </div>

            {/* CTA principal — al catálogo de cursos */}
            <div className="mt-8">
              <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Mientras esperas tu clase
              </p>
              <h2 className="mt-2 text-[20px] md:text-[24px] font-bold text-slate-900 leading-snug">
                Conoce nuestros cursos y tarifas
              </h2>
              <p className="mt-2 text-[14px] md:text-[15px] text-slate-600 leading-relaxed">
                Visita nuestra web para ver todos los detalles, niveles y precios
                de los packs disponibles.
              </p>
              <a
                href="https://www.aprender-aleman.de/es/cursos"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 h-12 md:h-14 px-6 rounded-2xl
                           bg-warm text-warm-foreground font-semibold text-[15px] md:text-base
                           shadow-lg shadow-warm/20 hover:shadow-warm/30 active:scale-[0.98] transition"
              >
                Ver cursos y precios
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </a>
            </div>

            {/* Acciones secundarias — guardar link + ir al inicio */}
            <div className="mt-10 pt-6 border-t border-slate-100">
              <a
                href={magicLinkUrl}
                className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-warm transition-colors underline-offset-4 hover:underline"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Guardar enlace de la clase
              </a>
              <p className="mt-2 text-xs text-slate-500 leading-snug">
                El aula abre 15 minutos antes. Recibirás recordatorios por
                WhatsApp y email antes de la clase.
              </p>

              <Link
                href="/"
                className="mt-6 inline-block text-sm text-slate-500 hover:text-slate-900 transition-colors"
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
