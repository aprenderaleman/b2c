import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { RangosManager } from "@/components/admin/RangosManager";

export const metadata = { title: "Config Rangos · Admin" };

export default async function RangosConfigPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("config_rangos")
    .select("*")
    .order("rol")
    .order("comision_pct");

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver al admin
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Configuracion de rangos
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Define los rangos, porcentajes de comision y umbrales para profesores y closers.
        </p>
      </div>
      <RangosManager initialRows={data ?? []} />
    </main>
  );
}
