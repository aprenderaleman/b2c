import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = { title: "Admin · Aprender-Aleman.de" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {session?.user && (
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
            <nav className="flex items-center gap-6 text-sm font-medium">
              <Link href="/admin" className="text-brand-600 dark:text-brand-400 font-bold">
                Aprender-Aleman<span className="text-slate-600 dark:text-slate-400">.de</span> Admin
              </Link>
              <Link href="/admin" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Hoy</Link>
              <Link href="/admin/leads" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Leads</Link>
              <Link href="/admin/estudiantes" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Estudiantes</Link>
              <Link href="/admin/profesores" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Profesores</Link>
              <Link href="/admin/clases" className="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">Clases</Link>
            </nav>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <form action={async () => { "use server"; await signOut({ redirectTo: "/admin/login" }); }}>
                <button type="submit" className="text-sm text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400">
                  Cerrar sesión
                </button>
              </form>
            </div>
          </div>
        </header>
      )}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {children}
      </div>
    </div>
  );
}
