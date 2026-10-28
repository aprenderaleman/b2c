import { notFound } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getEpisode, listComments } from "@/lib/serie";
import { EpisodeView } from "@/components/serie/EpisodeView";

export const dynamic = "force-dynamic";

export default async function TeacherEpisodePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireRoleWithImpersonation(["teacher", "admin", "superadmin"], "teacher");
  const ep = await getEpisode(slug, null);
  if (!ep) notFound();
  const comments = await listComments(ep.id, null);
  return <EpisodeView ep={ep} comments={comments} canInteract={false} basePath="/profesor/serie" />;
}
