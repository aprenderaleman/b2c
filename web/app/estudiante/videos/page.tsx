import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { listEpisodes } from "@/lib/serie";
import { EpisodeGrid } from "@/components/serie/EpisodeGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Videos · Aprender-Aleman.de" };

/** Serie "Un dominicano en Alemania" — temporada 1 (A1), vista del estudiante. */
export default async function StudentVideosPage() {
  const session = await requireRoleWithImpersonation(["student", "admin", "superadmin"], "student");
  const student = await getStudentByUserId(session.user.id);
  const episodes = await listEpisodes(student?.id ?? null);
  return <EpisodeGrid episodes={episodes} basePath="/estudiante/videos" />;
}
