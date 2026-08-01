import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { CloserProfile } from "@/components/closer/CloserProfile";

export const metadata = { title: "Perfil · Closer" };

export default async function CloserPerfilPage() {
  const session = await requireRole(["closer"]);
  const closerId = session.user.id;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("id, email, full_name, phone, rango, created_at")
    .eq("id", closerId)
    .single();

  if (!data) {
    return (
      <main className="p-6">
        <p className="text-red-600">No se encontro el perfil.</p>
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Mi perfil
      </h1>
      <CloserProfile profile={data as { id: string; email: string; full_name: string | null; phone: string | null; rango: string | null; created_at: string }} />
    </main>
  );
}
