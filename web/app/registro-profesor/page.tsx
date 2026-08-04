import Link from "next/link";
import { validateInvitation } from "@/lib/teacher-invitations";
import { supabaseAdmin } from "@/lib/supabase";
import { RegistroForm } from "./RegistroForm";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Registro de profesor · Aprender-Aleman.de" };

/**
 * Página pública (no auth) para que un candidato a profesor complete
 * su registro con su código de invitación.
 *
 * Las condiciones (tarifa, rango) vienen de la invitación que creó el
 * admin — se muestran en solo lectura y el candidato no puede
 * editarlas. El email también queda bloqueado al de la invitación.
 */
export default async function ProfesorRegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const validation = code ? await validateInvitation(code) : { ok: false as const, reason: "not_found" as const };

  if (!validation.ok) {
    return <InvalidScreen reason={validation.reason} />;
  }

  const inv = validation.invitation;

  // % de comisión del rango para mostrarlo en "Tus condiciones".
  let comisionPct: number | null = null;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("config_rangos")
      .select("comision_pct")
      .eq("rol", "teacher")
      .eq("rango", inv.rango)
      .maybeSingle();
    comisionPct = (data as { comision_pct: number } | null)?.comision_pct ?? null;
  } catch { /* la card muestra solo el nombre del rango */ }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Únete como profesor
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Completa tus datos. Tus condiciones acordadas ya están
            configuradas — al aprobar tu perfil te enviaremos el acceso
            a la plataforma por email.
          </p>
        </div>
        <RegistroForm
          code={code!}
          invEmail={inv.email ?? ""}
          invName={inv.name ?? ""}
          rateIndividual={inv.rate_individual_eur}
          rango={inv.rango}
          comisionPct={comisionPct}
        />
      </div>
    </main>
  );
}

function InvalidScreen({ reason }: { reason: "not_found" | "expired" | "already_used" | "revoked" }) {
  const labels: Record<string, { title: string; body: string }> = {
    not_found:    { title: "Link no válido",  body: "Este link de invitación no existe o se escribió mal." },
    expired:      { title: "Link expirado",   body: "Este link tenía una validez de 14 días y ya caducó. Pide uno nuevo a la academia." },
    already_used: { title: "Link ya usado",   body: "Este link ya se utilizó para registrar un profesor. Pide uno nuevo si necesitas registrar otra cuenta." },
    revoked:      { title: "Link revocado",   body: "Este link fue invalidado por la academia. Contacta para que te envíen uno nuevo." },
  };
  const { title, body } = labels[reason] ?? labels.not_found;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>🔒</div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
        <Link
          href="https://aprender-aleman.de"
          className="mt-6 inline-block text-sm text-brand-600 hover:underline"
        >
          ← Volver al sitio
        </Link>
      </div>
    </main>
  );
}
