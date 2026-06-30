import { requireRole } from "@/lib/rbac";
import { getFeed } from "@/lib/community";
import { CommunityFeed } from "./CommunityFeed";

export default async function CommunityPage() {
  const session = await requireRole(["student", "teacher", "admin", "superadmin"]);
  const userId = session.user.id;
  const role   = session.user.role;
  const name   = session.user.name ?? "Usuario";

  const initialPosts = await getFeed(userId, 20);

  return (
    <CommunityFeed
      initialPosts={initialPosts}
      currentUserId={userId}
      currentUserRole={role}
      currentUserName={name}
    />
  );
}
