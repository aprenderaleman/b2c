import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { formatClassDateEs, formatClassTimeEs } from "@/lib/classes";
import { AgendarClient } from "./AgendarClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agendar clase · Aprender-Aleman.de" };

/**
 * Agendado self-service del alumno (fase 3 — Gelfis 2026-10-06).
 * Sin query → agendar nueva clase. Con ?mover=<classId> → reagendar esa
 * clase (validaciones duras en el API; aquí solo el texto de contexto).
 */
export default async function AgendarPage({
  searchParams,
}: {
  searchParams: Promise<{ mover?: string }>;
}) {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );
  const { mover } = await searchParams;

  const student = await getStudentByUserId(session.user.id);
  if (!student) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Agendar clase</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene perfil de estudiante. Escríbenos y lo resolvemos.
        </p>
      </main>
    );
  }

  // Modo reagenda: texto de contexto ("moviendo tu clase del jueves…").
  let moveInfo: string | null = null;
  if (mover) {
    const sb = supabaseAdmin();
    const { data: cls } = await sb
      .from("classes")
      .select("scheduled_at, class_participants!inner(student_id)")
      .eq("id", mover)
      .eq("class_participants.student_id", student.id)
      .maybeSingle();
    const at = (cls as { scheduled_at: string } | null)?.scheduled_at;
    if (at) moveInfo = `${formatClassDateEs(at)} · ${formatClassTimeEs(at)}`;
  }

  return (
    <main className="space-y-5">
      <header>
        <Link href="/estudiante/clases" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Mis clases
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          {mover ? "Reagendar clase" : "Agendar una clase"}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Elige un hueco libre de tu profesor. Puedes agendar con al menos 12&nbsp;horas
          de antelación{mover ? " y mover una clase hasta 24 horas antes de su inicio" : ""}.
        </p>
      </header>

      <AgendarClient moveClassId={mover ?? null} moveClassInfo={moveInfo} />
    </main>
  );
}
