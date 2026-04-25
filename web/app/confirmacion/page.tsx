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
 * The PRIMARY CTA points the lead to SCHULE so they can start
 * learning German immediately while waiting for the trial day.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHULE_URL = "https://schule.aprender-aleman.de";

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

          {/* Booking summary card */}
          <div className="mt-8 rounded-2xl bg-white border border-border shadow-sm p-6 text-left space-y-3">
            <SummaryRow k="Fecha"     v={startDate} cap />
            <SummaryRow k="Profesor"  v={teacherName} />
            <SummaryRow k="Duración"  v={`${r.duration_minutes ?? 45} minutos`} />
          </div>
        </div>
      </section>

      {/* ── NAVY: PRIMARY CTA — start learning with SCHULE ── */}
      <section className="section-navy section-pad">
        <div className="container-x text-center max-w-3xl">
          <span className="eyebrow-on-navy">Mientras esperas tu clase</span>
          <h2 className="mt-3 text-[30px] md:text-[42px] font-bold tracking-tight text-white leading-[1.1]">
            Empieza a aprender alemán hoy mismo
          </h2>
          <p className="mt-4 text-base md:text-lg text-white/75 leading-relaxed">
            Entra a <strong className="text-white">SCHULE</strong>, nuestra plataforma
            online: clases interactivas, ejercicios por nivel y tu profesor IA Hans
            disponible 24/7 para practicar por voz o por texto.
          </p>
          <div className="mt-8">
            <a
              href={SCHULE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-lg"
            >
              Empezar ahora con SCHULE
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
