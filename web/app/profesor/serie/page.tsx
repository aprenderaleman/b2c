import { requireRoleWithImpersonation } from "@/lib/rbac";
import { listEpisodes } from "@/lib/serie";
import { EpisodeGrid } from "@/components/serie/EpisodeGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Videos · Aprender-Aleman.de" };

/**
 * Serie para profesores (Gelfis 2026-10-28): misma rejilla que los alumnos,
 * para que conozcan los capítulos y puedan usarlos en clase. Solo lectura:
 * las valoraciones y comentarios son de los alumnos.
 */
export default async function TeacherSeriePage() {
  await requireRoleWithImpersonation(["teacher", "admin", "superadmin"], "teacher");
  const episodes = await listEpisodes(null);
  return <EpisodeGrid episodes={episodes} basePath="/profesor/serie" />;
}
