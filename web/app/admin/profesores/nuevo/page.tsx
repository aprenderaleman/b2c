import Link from "next/link";
import { CreateTeacherForm } from "@/components/admin/CreateTeacherForm";

export const metadata = { title: "Nuevo profesor · Admin" };

export default function NewTeacherPage() {
  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin/profesores" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver a profesores
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Crear profesor</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Se creará el usuario, se enviará un correo con los accesos y la contraseña temporal.
          El profesor podrá iniciar sesión en <code className="text-xs">b2c.aprender-aleman.de</code>.
        </p>
      </div>
      <CreateTeacherForm />
    </main>
  );
}
