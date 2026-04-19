import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthError } from "next-auth";
import { signIn, auth } from "@/lib/auth";
import { defaultPathForRole, type Role } from "@/lib/rbac";

/**
 * Next.js uses a thrown "NEXT_REDIRECT" sentinel to perform its
 * redirect() helper. Any catch block that re-throws user-supplied
 * errors must let this special error bubble up unchanged, otherwise
 * the redirect turns into a 500.
 */
function isRedirectError(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT"));
}

export const metadata = { title: "Iniciar sesión · Aprender-Aleman.de" };

/**
 * Unified sign-in page for every role: superadmin, admin, teacher, student.
 * Replaces the old /admin/login (kept as a redirect alias for any stale
 * links or bookmarks).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const session = await auth();
  const { error, next } = await searchParams;

  // If already signed in WITH a valid role, bounce to the right home.
  // A session without `role` means the cookie is from an older build —
  // ignore it and let the user sign in again (prevents redirect loops).
  const sessionRole = (session?.user as { role?: Role } | undefined)?.role;
  if (session?.user && sessionRole) {
    redirect(next && next !== "/" ? next : defaultPathForRole(sessionRole));
  }

  async function doLogin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email:      String(formData.get("email") ?? ""),
        password:   String(formData.get("password") ?? ""),
        redirectTo: "/login/redirect",
      });
    } catch (e) {
      // Next's redirect() helper works by throwing — re-throw so Next
      // can actually perform the navigation. Without this the redirect
      // surfaces as an "Application error" page.
      if (isRedirectError(e)) throw e;

      // NextAuth surfaces bad credentials / config issues as AuthError.
      // Map them back to /login?error=... so the UI shows "credenciales
      // incorrectas" instead of a 500.
      if (e instanceof AuthError) {
        redirect(`/login?error=${encodeURIComponent(e.type)}`);
      }
      // Anything else — log and re-throw so the error boundary can
      // display something useful instead of swallowing it silently.
      console.error("login server action failed:", e);
      throw e;
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
            Aprender-Aleman.de
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Plataforma de la academia
          </p>
        </div>

        <form
          action={doLogin}
          className="rounded-3xl bg-white dark:bg-slate-900
                     border border-slate-200 dark:border-slate-800
                     p-7 shadow-sm"
        >
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Iniciar sesión
          </h2>

          <label className="block mt-5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Correo electrónico
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="input-text mt-1"
            />
          </label>

          <label className="block mt-4">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Contraseña
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input-text mt-1"
            />
          </label>

          {error && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
              Credenciales incorrectas. Inténtalo de nuevo.
            </p>
          )}

          <button type="submit" className="btn-primary w-full mt-6">
            Entrar
          </button>

          <div className="mt-4 text-center">
            <Link
              href="/forgot-password"
              className="text-xs text-slate-500 dark:text-slate-400
                         hover:text-brand-600 dark:hover:text-brand-400
                         underline-offset-4 hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </form>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
          © {new Date().getFullYear()} Linguify Global LLC ·{" "}
          <Link href="/privacy" className="hover:text-brand-600 dark:hover:text-brand-400 underline-offset-4 hover:underline">
            Privacidad
          </Link>
        </p>
      </div>
    </main>
  );
}
