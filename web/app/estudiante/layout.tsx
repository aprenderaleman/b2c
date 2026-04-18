import Link from "next/link";
import { signOut } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsBell } from "@/components/NotificationsBell";

export const metadata = { title: "Estudiante · Aprender-Aleman.de" };

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole(["student", "admin", "superadmin"]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/estudiante" className="text-brand-600 dark:text-brand-400 font-bold">
              Aprender-Aleman<span className="text-slate-600 dark:text-slate-400">.de</span>
            </Link>
            <Link href="/estudiante" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Inicio</Link>
            <Link href="/estudiante/clases" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Mis clases</Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
              {session.user.name ?? session.user.email}
            </span>
            <NotificationsBell />
            <ThemeToggle />
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <button type="submit" className="text-sm text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {children}
      </div>
    </div>
  );
}
