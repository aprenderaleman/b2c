import { listTrialClasses, partitionByTime } from "@/lib/trial-classes";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { TrialHubShell } from "@/app/profesor/clasedeprueba/TrialHubShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases de prueba · Admin" };

export default async function AdminTrialClassesPage() {
  const rows = await listTrialClasses();
  const { upcoming, past } = partitionByTime(rows);
  const session = await auth();
  const canDelete = (session?.user as { role?: string } | undefined)?.role === "superadmin";

  const convertedUserIds = [
    ...new Set(
      rows
        .map((r) => r.leadConvertedToUserId)
        .filter((x): x is string => !!x),
    ),
  ];
  const studentMap: Record<string, string> = {};
  if (convertedUserIds.length > 0) {
    const sb = supabaseAdmin();
    const { data: students } = await sb
      .from("students")
      .select("id, user_id")
      .in("user_id", convertedUserIds);
    for (const s of students ?? []) {
      studentMap[s.user_id] = s.id;
    }
  }

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Clases de prueba
        </h1>
      </header>

      <TrialHubShell
        upcoming={upcoming}
        past={past}
        studentMap={studentMap}
        isAdmin
        canDelete={canDelete}
      />
    </main>
  );
}
