import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { CadenciaManager } from "@/components/admin/CadenciaManager";

export const metadata = { title: "Config Cadencia · Admin" };

export default async function CadenciaConfigPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("config_cadencia")
    .select("*")
    .order("tipo")
    .order("paso");

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver al admin
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Configuracion de cadencia
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Define los pasos de seguimiento automatico que se generan al asignar un closer a un lead.
        </p>
      </div>
      <CadenciaManager initialRows={data ?? []} />
    </main>
  );
}
