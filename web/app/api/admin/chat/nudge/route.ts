import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendUnreadChatReminder } from "@/lib/chat-email-notify";

/**
 * POST /api/admin/chat/nudge { chatId, userId } — reenvía a un participante
 * el email "Tienes un mensaje nuevo" con el botón a ese chat (Gelfis
 * 2026-10-30, caso Veronica/Tatiane). Auth: CRON_SECRET o sesión admin.
 */
async function authorised(req: Request): Promise<boolean> {
  const expected = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  if (expected && bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  if (expected && req.headers.get("x-cron-secret") === expected) return true;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "admin" || role === "superadmin";
}

const Body = z.object({ chatId: z.string().uuid(), userId: z.string().uuid() });

export async function POST(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const r = await sendUnreadChatReminder(parsed.data.chatId, parsed.data.userId);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
