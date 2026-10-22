import { NextResponse } from "next/server";
import { resolveChatCaller } from "@/lib/chat-auth";
import { ensureDirectChat } from "@/lib/chat";

/**
 * POST /api/chat/start-colleague
 * Create (or find) a direct chat between the caller and a colleague teacher.
 * Body: { colleague_user_id: string }
 */
export async function POST(req: Request) {
  const caller = await resolveChatCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const colleagueUserId = body.colleague_user_id;
  if (!colleagueUserId || typeof colleagueUserId !== "string") {
    return NextResponse.json({ error: "colleague_user_id required" }, { status: 400 });
  }

  const chatId = await ensureDirectChat(caller.userId, colleagueUserId);
  return NextResponse.json({ chat_id: chatId });
}
