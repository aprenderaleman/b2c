import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { ChatShell } from "@/app/chat/ChatShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chats · Setter" };

/**
 * Chat del setter (Gelfis 2026-11-27): contacto directo con Gelfis
 * (academia) y con el resto del equipo de ventas (closers y setters).
 * Mismo ChatShell de la plataforma en modo equipo.
 */
export default async function SetterChatsPage() {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  return (
    <main className="space-y-4">
      <header>
        <Link href="/setter/urgentes" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver a Leads Urgentes
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Chats</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Habla directo con la academia y con el equipo (closers y setters).
        </p>
      </header>

      <ChatShell
        currentUserId={session.user.id}
        currentUserName={session.user.name ?? session.user.email ?? "Yo"}
        embedded
        teamMode
      />
    </main>
  );
}
