import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { ClosersTable } from "@/components/admin/ClosersTable";

export const metadata = { title: "Closers · Admin" };

export default async function ClosersPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data: closers } = await sb
    .from("users")
    .select("id, email, full_name, phone, active, rango, flujo_activo, acepta_sesiones, created_at")
    .eq("role", "closer")
    .order("created_at", { ascending: false });

  const closerList = (closers ?? []) as Array<{
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    active: boolean;
    rango: string | null;
    flujo_activo: boolean;
    acepta_sesiones: boolean;
    created_at: string;
  }>;

  const closerIds = closerList.map((c) => c.id);
  let leadCounts: Record<string, number> = {};
  if (closerIds.length > 0) {
    const { data: leads } = await sb
      .from("leads")
      .select("closer_id")
      .in("closer_id", closerIds);
    for (const l of (leads ?? []) as Array<{ closer_id: string }>) {
      leadCounts[l.closer_id] = (leadCounts[l.closer_id] ?? 0) + 1;
    }
  }

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Closers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {closerList.length} closer{closerList.length !== 1 ? "s" : ""} registrado{closerList.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/admin/closers/nuevo"
          className="btn-primary text-sm"
        >
          Nuevo closer
        </Link>
      </header>

      <ClosersTable closers={closerList} leadCounts={leadCounts} />
    </main>
  );
}
