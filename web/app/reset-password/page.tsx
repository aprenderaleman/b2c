import Link from "next/link";
import { ResetPasswordForm } from "./Form";

export const metadata = { title: "Elegir nueva contraseña · Aprender-Aleman.de" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
            Aprender-Aleman.de
          </h1>
        </div>

        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-7 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Elige tu nueva contraseña
          </h2>

          {!token ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              Enlace inválido. Solicita uno nuevo desde{" "}
              <Link href="/forgot-password" className="underline">recuperar contraseña</Link>.
            </p>
          ) : (
            <ResetPasswordForm token={token} />
          )}

          <div className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            <Link
              href="/login"
              className="hover:text-brand-600 dark:hover:text-brand-400 underline-offset-4 hover:underline"
            >
              ← Volver al inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
