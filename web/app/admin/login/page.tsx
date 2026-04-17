import { redirect } from "next/navigation";
import { signIn, auth } from "@/lib/auth";

export const metadata = { title: "Sign in · Admin" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/admin");

  const { error } = await searchParams;

  async function doLogin(formData: FormData) {
    "use server";
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/admin",
    });
  }

  return (
    <main className="min-h-[80vh] flex items-center justify-center">
      <form
        action={doLogin}
        className="w-full max-w-sm rounded-3xl bg-white border border-slate-200 p-8 shadow-sm"
      >
        <h1 className="text-xl font-bold text-slate-900">Admin sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Aprender-Aleman.de</p>

        <label className="block mt-6">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input-text mt-1"
          />
        </label>

        <label className="block mt-4">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input-text mt-1"
          />
        </label>

        {error && (
          <p className="mt-4 text-sm text-red-600">
            Invalid credentials. Try again.
          </p>
        )}

        <button type="submit" className="btn-primary w-full mt-6">
          Sign in
        </button>
      </form>
    </main>
  );
}
