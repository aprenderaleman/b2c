import { requireRole } from "@/lib/rbac";
import { ChatShell } from "./ChatShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat · Aprender-Aleman.de" };

export default async function ChatPage() {
  const session = await requireRole(["superadmin", "admin", "teacher", "student"]);
  return (
    <ChatShell
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? session.user.email ?? "Yo"}
    />
  );
}
