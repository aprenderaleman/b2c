import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { ChatShell } from "@/app/chat/ChatShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensajes · Profesor" };

/**
 * Mensajes del profesor (decisión Gelfis 2026-08-24: chat embebido en
 * los paneles de rol, no /chat standalone). Los chats se crean solos al
 * agendar clases (wireChatsForClass): directo por alumno individual,
 * grupal por serie de grupo.
 */
export default async function TeacherMessagesPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );

  return (
    <main className="space-y-4">
      <header>
        <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Mensajes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Conversaciones con tus estudiantes. Se abre un chat automáticamente con
          cada alumno (o grupo) al agendar clases.
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
