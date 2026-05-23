import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyTrialToken } from "@/lib/trial-token";

/**
 * GET /confirmacion?c={classId}&t={token}
 *
 * Standalone confirmation page the funnel redirects to after a
 * successful self-service booking. We don't render the success state
 * inline anymore — the lead lands on its own URL so the page is
 * bookmarkable and shareable, and so the homepage can stay focused
 * on the booking flow.
 *
 * The token is the same HMAC-signed magic-link token used to enter
 * the aula on the day of the class. We verify it server-side and
 * refuse to render anything sensitive if it's missing or invalid.
 *
 * El PRIMARY CTA apunta al catálogo de cursos en la web pública
 * (decisión Gelfis 2026-05-22). Antes apuntaba a SCHULE — los imports
 * SCHULE_MAINTENANCE y el const SCHULE_URL ya no se usan aquí.
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

  // Pull the booking — name, date, teacher, short_code.
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

  // Prefer the short URL (matches what we sent over email/WhatsApp).
  // Falls back to the long signed-token URL if the class somehow lacks
  // a short_code (older bookings made before migration 036).
  const magicLinkUrl = r.short_code
    ? `/c/${r.short_code}`
    : `/trial/${classId}?t=${encodeURIComponent(token)}`;

  return (
    <div className="theme-light bg-white text-foreground min-h-screen">
      <Header />

      {/* ── HERO (light): confirmation header + booking summary ── */}
      <section className="bg-white">
        <div className="container-x pt-12 sm:pt-16 pb-8 text-center max-w-2xl">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-warm/15 text-[#B4651F] mb-5">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <span className="eyebrow">Reserva confirmada</span>
          <h1 className="mt-3 text-[36px] sm:text-5xl font-bold tracking-tight text-foreground leading-[1.05]">
            ¡Listo{firstName ? `, ${firstName}` : ""}!
            <br className="hidden sm:block"/>
            Tu clase está agendada.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            Te enviamos los detalles a tu correo y a tu WhatsApp. El día de la
            clase entrarás directamente con el enlace que te llegó — sin contraseña.
          </p>

          {/* Bloque "valor 30 €" destacado — refuerzo de asistencia.
              Va ARRIBA del summary para que sea lo primero que vea el
              lead al aterrizar tras confirmar. Decisión Gelfis
              2026-05-22. */}
          <div className="mt-8 rounded-2xl border-2 border-amber-300 bg-amber-50 text-left p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5" aria-hidden>💎</span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold uppercase tracking-wider text-amber-900">
                  Tu clase tiene valor de 30 €
                </p>
                <p className="mt-1.5 text-[15px] text-amber-900 leading-snug">
                  Te la regalamos por asistir. Te esperamos
                  el <strong className="capitalize">{startDate}</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* Booking summary card */}
          <div className="mt-5 rounded-2xl bg-white border border-border shadow-sm p-6 text-left space-y-3">
            <SummaryRow k="Fecha"     v={startDate} cap />
            <SummaryRow k="Profesor"  v={teacherName} />
            <SummaryRow k="Duración"  v={`${r.duration_minutes ?? 45} minutos`} />
          </div>
        </div>
      </section>

      {/* ── NAVY: PRIMARY CTA — ver detalles y precios de los cursos.
              Antes apuntaba a SCHULE; decisión Gelfis 2026-05-22:
              direccionar al catálogo público de cursos en la web
              principal porque el lead aún no ha probado la clase y
              SCHULE le pide cuenta. ── */}
      <section className="section-navy section-pad">
        <div className="container-x text-center max-w-3xl">
          <span className="eyebrow-on-navy">Mientras esperas tu clase</span>
          <h2 className="mt-3 text-[30px] md:text-[42px] font-bold tracking-tight text-white leading-[1.1]">
            Conoce nuestros cursos y tarifas
          </h2>
          <p className="mt-4 text-base md:text-lg text-white/75 leading-relaxed">
            Visita nuestra web para ver todos los detalles, niveles y
            precios de los packs disponibles.
          </p>
          <div className="mt-8">
            <a
              href="https://www.aprender-aleman.de/es/cursos"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-lg"
            >
              Ver cursos y precios
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ── MUTED: secondary actions ── */}
      <section className="section-muted-bg section-pad">
        <div className="container-x text-center max-w-2xl">
          <a
            href={magicLinkUrl}
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-warm transition-colors underline-offset-4 hover:underline"
          >
            Guardar enlace de la clase
          </a>
          <p className="mt-2 text-xs text-muted-foreground">
            El aula abre 15 minutos antes. Recibirás recordatorios por email y
            WhatsApp antes de la clase.
          </p>

          <Link
            href="/"
            className="mt-10 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Volver al inicio
          </Link>
        </div>
      </section>
    </div>
  );
}

function SummaryRow({ k, v, cap = false }: { k: string; v: string; cap?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-20 shrink-0">
        {k}
      </span>
      <span className={`text-sm font-medium text-foreground ${cap ? "capitalize" : ""}`}>
        {v}
      </span>
    </div>
  );
}
