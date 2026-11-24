import { requireRoleWithImpersonation } from "@/lib/rbac";
import { listEpisodes } from "@/lib/serie";
import { EpisodeGrid } from "@/components/serie/EpisodeGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Videos (para estudiantes) · Aprender-Aleman.de" };

/**
 * Serie "Un dominicano en Alemania" — vista del PROFESOR (Gelfis
 * 2026-11-27): los profes la ven para conocer el material que reciben
 * sus alumnos (beneficio del Bono de Acción Rápida). Sin valoraciones ni
 * registro de reproducciones (eso es solo de estudiantes). OJO: la ruta
 * es /profesor/serie porque /profesor/videos es el Estudio de grabación.
 */
export default async function TeacherSeriePage() {
  await requireRoleWithImpersonation(["teacher", "admin", "superadmin"], "teacher");
  const episodes = await listEpisodes(null);
  return <EpisodeGrid episodes={episodes} basePath="/profesor/serie" />;
}
