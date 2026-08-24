import { NextResponse } from "next/server";
import { resolveChatCaller } from "@/lib/chat-auth";
import { listChatsForUser } from "@/lib/chat";

/**
 * GET /api/chat
 * List the caller's conversations, sorted by last_message_at desc.
 * Honors admin impersonation ("Ver como") via resolveChatCaller.
 */
export async function GET() {
  const caller = await resolveChatCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chats = await listChatsForUser(caller.userId);
  return NextResponse.json({ chats });
}
