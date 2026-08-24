import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { ChatShell } from "@/app/chat/ChatShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensajes · Estudiante" };

/**
 * Mensajes del estudiante: chat directo con su profesor (y chats de
 * grupo si está en clases grupales). Se crean solos al agendar clases.
 */
export default async function StudentMessagesPage() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );

  return (
    <main className="space-y-4">
      <header>
        <Link href="/estudiante" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Mensajes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Habla con tu profesor entre clases: dudas, tareas, materiales.
        </p>
      </header>

      <ChatShell
        currentUserId={session.user.id}
        currentUserName={session.user.name ?? session.user.email ?? "Yo"}
        embedded
      />
    </main>
  );
}
