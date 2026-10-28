import { notFound } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { getEpisode, listComments } from "@/lib/serie";
import { EpisodeView } from "@/components/serie/EpisodeView";

export const dynamic = "force-dynamic";

export default async function EpisodePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireRoleWithImpersonation(["student", "admin", "superadmin"], "student");
  const student = await getStudentByUserId(session.user.id);
  const ep = await getEpisode(slug, student?.id ?? null);
  if (!ep) notFound();
  const comments = await listComments(ep.id, student?.id ?? null);
  // Valorar/comentar: solo alumnos (también cuando el admin "ve como" un alumno).
  const canInteract = session.user.role === "student" && !!student;
  return <EpisodeView ep={ep} comments={comments} canInteract={canInteract} basePath="/estudiante/videos" />;
}
