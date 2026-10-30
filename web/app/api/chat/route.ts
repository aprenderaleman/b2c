import { NextResponse } from "next/server";
import { resolveChatCaller } from "@/lib/chat-auth";
import { listChatsForUser, getColleagueContacts } from "@/lib/chat";

/**
 * GET /api/chat
 * List the caller's conversations, sorted by last_message_at desc.
 * Honors admin impersonation ("Ver como") via resolveChatCaller.
 * For lead teachers, also returns `colleagues` with available contacts.
 */
export async function GET() {
  const caller = await resolveChatCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [chats, colleagues] = await Promise.all([
    listChatsForUser(caller.userId, caller.role),
    getColleagueContacts(caller.userId),
  ]);
  return NextResponse.json({ chats, colleagues });
}
