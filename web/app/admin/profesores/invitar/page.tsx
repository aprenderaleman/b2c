import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { listActiveInvitations, buildInvitationUrl } from "@/lib/teacher-invitations";
import { InviteTeacherPanel } from "./InviteTeacherPanel";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Invitar profesor · Admin" };

/**
 * Página admin para generar links de invitación a profesores. El
 * candidato abre el link y se auto-registra en /profesor/registro.
 * Tras enviar el form, queda pendiente de aprobación manual.
 */
export default async function InviteTeacherPage() {
  await requireRole(["superadmin", "admin"]);
  const invitations = await listActiveInvitations();
  const list = invitations.map(inv => ({
    id:         inv.id,
    code:       inv.code,
    email:      inv.email,
    notes:      inv.notes,
    created_at: inv.created_at,
    expires_at: inv.expires_at,
    url:        buildInvitationUrl(inv.code),
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
          Genera un link que el candidato puede usar para auto-registrarse
          con todos sus datos. Tras enviarlo, recibirás una notificación
          para revisar el perfil y aprobarlo.
        </p>
      </div>

      <InviteTeacherPanel initialInvitations={list} />
    </main>
  );
}
