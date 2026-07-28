import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { AprobacionesList } from "@/components/admin/AprobacionesList";

export const metadata = { title: "Aprobaciones · Admin" };

export default async function AprobacionesPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data: rawPendientes } = await sb
    .from("ventas")
    .select("id, lead_id, solicitado_por, rol_solicitante, pack_id, payment_type, monto_cents, moneda, estado, created_at, leads!inner(full_name, email, whatsapp_normalized), users!ventas_solicitado_por_fkey(full_name)")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false });

  const { data: rawRecientes } = await sb
    .from("ventas")
    .select("id, lead_id, solicitado_por, rol_solicitante, pack_id, monto_cents, estado, motivo_rechazo, aprobado_at, created_at, leads!inner(full_name)")
    .in("estado", ["aprobada", "rechazada"])
    .order("aprobado_at", { ascending: false })
    .limit(20);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unwrapJoin = (row: any) => ({
    ...row,
    leads: Array.isArray(row.leads) ? row.leads[0] ?? { full_name: null } : row.leads,
    users: Array.isArray(row.users) ? row.users[0] ?? undefined : row.users,
  });

  const pendientes = (rawPendientes ?? []).map(unwrapJoin);
  const recientes = (rawRecientes ?? []).map(unwrapJoin);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Aprobaciones de venta
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {pendientes.length} ventas pendientes de aprobacion
        </p>
      </div>

      <AprobacionesList
        pendientes={pendientes}
        recientes={recientes}
      />
    </main>
  );
}
