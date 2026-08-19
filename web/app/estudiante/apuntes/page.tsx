import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { OpenInNewTab } from "./OpenInNewTab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apuntes de clase · Aprender-Aleman.de" };

export default async function ApuntesRedirect() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );
  const student = await getStudentByUserId(session.user.id);

  if (student?.document_url) {
    return <OpenInNewTab url={student.document_url} />;
  }

  return (
    <main className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Apuntes de clase
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Tu documento de apuntes aún no está disponible. Contacta con tu profesor o con el equipo.
      </p>
    </main>
  );
}
