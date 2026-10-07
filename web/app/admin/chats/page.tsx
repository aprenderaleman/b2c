import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { ChatShell } from "@/app/chat/ChatShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chats · Admin" };

/**
 * Chat de plataforma del ADMIN (Gelfis 2026-10-09): aquí ve y responde
 * sus conversaciones directas con los profes (avisos de novedades,
 * bonos, etc.). Mismo ChatShell que profes/estudiantes — el API lista
 * los chats donde su usuario participa.
 *
 * Ojo: /admin/mensajes es otra cosa (estadísticas de plantillas WA/email).
 */
export default async function AdminChatsPage() {
  const session = await requireRole(["superadmin", "admin"]);

  return (
    <main className="space-y-4">
      <header>
        <Link href="/admin" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Chats</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tus conversaciones directas en la plataforma (profes y estudiantes).
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
