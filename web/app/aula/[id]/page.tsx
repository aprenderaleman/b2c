import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { authorizeAulaAccess, authorizeTrialAulaAccess } from "@/lib/aula";
import { getClassById, formatClassTimeEs } from "@/lib/classes";
import { livekitConfigured } from "@/lib/livekit";
import { getTrialSession } from "@/lib/trial-token";
import { supabaseAdmin } from "@/lib/supabase";
import { AulaClient } from "./AulaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aula virtual · Aprender-Aleman.de" };

/**
 * Full-page branded classroom. Not wrapped by any role-layout so it fills
 * the viewport edge-to-edge. Role gate runs SSR; the actual media
 * connection is kicked off in the client component.
 */
export default async function AulaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const trial   = !session?.user ? await getTrialSession() : null;

  // Two paths into the aula:
  //   - logged-in user (admin / teacher / student)
  //   - trial-magic-link lead (no user row, cookie-based)
  if (!session?.user && !trial) redirect("/login");

  const cls = await getClassById(id);
  if (!cls) notFound();

  // Trial classes drop the auto-generated "Clase de prueba — Test
  // (Gelfis)" title in favour of a clean public-facing label and
  // pivot the fallback CTA to SCHULE (the lead has nowhere else
  // useful to go from here).
  const isTrial   = cls.is_trial;
  const aulaTitle = isTrial ? "Clase de prueba de alemán" : cls.title;

  let access;
  let displayName: string;
  let backHref:    string;

  if (session?.user) {
    const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;
    const userId = (session.user as { id: string }).id;
    const homeHref =
      role === "teacher" ? "/profesor"   :
      role === "student" ? "/estudiante" :
                           "/admin";

    access = await authorizeAulaAccess(id, userId, role);
    if (!access.ok) {
      if (access.reason === "cancelled")    return <CancelledScreen homeHref={homeHref} />;
      if (access.reason === "not_authorized") redirect(homeHref);
      return <NotFoundScreen homeHref={homeHref} />;
    }
    displayName = session.user.name ?? session.user.email ?? "Participante";
    backHref =
      role === "student"  ? `/estudiante/clases/${cls.id}` :
      role === "teacher"  ? `/profesor/clases/${cls.id}`   :
                            `/admin/clases/${cls.id}`;

    if (!access.canEnterNow) {
      return (
        <ClosedScreen
          opensAt={access.opensAt}
          closesAt={access.closesAt}
          classTitle={aulaTitle}
          homeHref={homeHref}
          isTrial={isTrial}
        />
      );
    }
  } else {
    // Lead path: validate trial cookie targets THIS class, look up
    // their lead name for the LiveKit display label.
    if (!trial || trial.class_id !== id) redirect("/funnel");
    access = await authorizeTrialAulaAccess(id, trial!.lead_id);
    if (!access.ok) {
      if (access.reason === "cancelled") return <CancelledScreen homeHref="/funnel" />;
      redirect("/funnel");
    }
    const sb = supabaseAdmin();
    const { data: lead } = await sb.from("leads").select("name").eq("id", trial!.lead_id).maybeSingle();
    displayName = (lead as { name: string | null } | null)?.name ?? "Invitado";
    backHref = "/funnel";

    if (!access.canEnterNow) {
      return (
        <ClosedScreen
          opensAt={access.opensAt}
          closesAt={access.closesAt}
          classTitle={aulaTitle}
          homeHref="/"
          isTrial={isTrial}
        />
      );
    }
  }

  if (!livekitConfigured()) {
    return <NotConfiguredScreen classTitle={aulaTitle} homeHref={backHref} />;
  }

  return (
    <AulaClient
      classId={cls.id}
      classTitle={aulaTitle}
      scheduledAt={cls.scheduled_at}
      durationMinutes={cls.duration_minutes}
      isHost={access.role === "host"}
      displayName={displayName}
      backHref={backHref}
    />
  );
}

// ───────────────────────────────────────────────────────────────────
// Fallback screens
// ───────────────────────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-slate-100 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg rounded-3xl bg-slate-800/60 backdrop-blur border border-slate-700 p-8 text-center shadow-2xl">
        {children}
      </div>
    </main>
  );
}

function ClosedScreen({
  opensAt, closesAt, classTitle, homeHref, isTrial,
}: {
  opensAt: Date; closesAt: Date; classTitle: string;
  homeHref: string; isTrial?: boolean;
}) {
  const now = new Date();
  const isBefore = now < opensAt;
  return (
    <Frame>
      <div className="text-5xl mb-4" aria-hidden>{isBefore ? "⏳" : "🔒"}</div>
      <h1 className="text-2xl font-bold">{classTitle}</h1>
      <p className="mt-3 text-slate-300">
        {isBefore
          ? <>El aula abrirá 15 minutos antes del inicio.<br/>Disponible a las <strong className="text-brand-300">{formatClassTimeEs(opensAt)}</strong> (Berlín).</>
          : <>El aula ya ha cerrado para esta clase (30 min después del final).</>}
      </p>
      <p className="mt-6 text-xs text-slate-400">
        Cierre total: {formatClassTimeEs(closesAt)} (Berlín)
      </p>

      {isTrial ? (
        // The lead is just sitting on /aula/{id} too early. Send them to
        // SCHULE so they can start practising while they wait, instead
        // of bouncing them back to the marketing home.
        <>
          <a
            href="https://schule.aprender-aleman.de"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-8 inline-flex"
          >
            🎓 Empezar ahora con SCHULE
          </a>
          <p className="mt-3 text-xs text-slate-400">
            Practica gratis con Hans (IA) y los cursos online mientras esperas tu clase.
          </p>
        </>
      ) : (
        <Link href={homeHref} className="btn-primary mt-8 inline-flex">
          Volver al inicio
        </Link>
      )}
    </Frame>
  );
}

function CancelledScreen({ homeHref }: { homeHref: string }) {
  return (
    <Frame>
      <div className="text-5xl mb-4" aria-hidden>❌</div>
      <h1 className="text-2xl font-bold">Clase cancelada</h1>
      <p className="mt-3 text-slate-300">Esta clase ha sido cancelada. Si crees que es un error, contacta con el equipo.</p>
      <Link href={homeHref} className="btn-primary mt-8 inline-flex">Volver al inicio</Link>
    </Frame>
  );
}

function NotFoundScreen({ homeHref }: { homeHref: string }) {
  return (
    <Frame>
      <div className="text-5xl mb-4" aria-hidden>🔍</div>
      <h1 className="text-2xl font-bold">Clase no encontrada</h1>
      <Link href={homeHref} className="btn-primary mt-8 inline-flex">Volver al inicio</Link>
    </Frame>
  );
}

function NotConfiguredScreen({ classTitle, homeHref }: { classTitle: string; homeHref: string }) {
  return (
    <Frame>
      <div className="text-5xl mb-4" aria-hidden>🛠️</div>
      <h1 className="text-2xl font-bold">Aula en preparación</h1>
      <p className="mt-3 text-slate-300">
        {classTitle} está agendada, pero la sala de video aún no está
        configurada en el servidor. Avisaremos a los participantes en cuanto
        esté lista.
      </p>
      <Link href={homeHref} className="btn-primary mt-8 inline-flex">Volver al inicio</Link>
    </Frame>
  );
}
