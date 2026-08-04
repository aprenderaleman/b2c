import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { listInvitations, buildInvitationUrl, invitationStatus } from "@/lib/teacher-invitations";
import { InviteTeacherPanel } from "./InviteTeacherPanel";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Invitar profesor · Admin" };

/**
 * Página admin para invitar profesores por email. El admin fija las
 * condiciones acordadas (tarifa individual, rango, trials) que se
 * aplican al perfil cuando el candidato completa su registro en
 * /registro-profesor. Tras completarse, queda pendiente de aprobación.
 */
export default async function InviteTeacherPage() {
  await requireRole(["superadmin", "admin"]);
  const invitations = await listInvitations();
  const list = invitations.map(inv => ({
    id:              inv.id,
    code:            inv.code,
    email:           inv.email,
    name:            inv.name,
    notes:           inv.notes,
    rate_individual: inv.rate_individual_eur,
    rango:           inv.rango,
    accepts_trials:  inv.accepts_trials,
    created_at:      inv.created_at,
    expires_at:      inv.expires_at,
    last_sent_at:    inv.last_sent_at,
    status:          invitationStatus(inv),
    url:             buildInvitationUrl(inv.code),
  }));

  return (
    <main className="space-y-6 max-w-2xl">
      <div>
        <Link href="/admin/profesores" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver a profesores
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Invitar profesor
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configura las condiciones acordadas y envía la invitación por
          email. El candidato completa sus datos con tus condiciones ya
          fijadas (no puede editarlas). Al completar, recibirás una
          notificación para aprobar el perfil con 1 click.
        </p>
      </div>

      <InviteTeacherPanel initialInvitations={list} />
    </main>
  );
}
