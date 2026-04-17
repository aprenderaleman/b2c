import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

export const metadata = { title: "Admin · Aprender-Aleman.de" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-50">
      {session?.user && (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
            <nav className="flex items-center gap-6 text-sm font-medium">
              <Link href="/admin" className="text-brand-600 font-bold">
                Aprender-Aleman<span className="text-slate-600">.de</span> Admin
              </Link>
              <Link href="/admin" className="text-slate-700 hover:text-brand-600">Today</Link>
              <Link href="/admin/leads" className="text-slate-700 hover:text-brand-600">All leads</Link>
            </nav>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/admin/login" }); }}>
              <button type="submit" className="text-sm text-slate-600 hover:text-brand-600">
                Sign out
              </button>
            </form>
          </div>
        </header>
      )}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {children}
      </div>
    </div>
  );
}
