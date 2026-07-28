import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { ComisionesConfigManager } from "@/components/admin/ComisionesConfigManager";

export const metadata = { title: "Config Comisiones · Admin" };

export default async function ComisionesConfigPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("config_comisiones")
    .select("*")
    .order("clave");

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver al admin
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Configuracion de comisiones
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Parametros globales del sistema de comisiones: pool maximo, bonus rescate, factor precalificacion.
        </p>
      </div>
      <ComisionesConfigManager initialRows={data ?? []} />
    </main>
  );
}
