import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ensureDirectChat } from "@/lib/chat";

/**
 * POST /api/admin/chat/direct { userId }
 * Abre (o reutiliza) el chat directo entre el admin y cualquier profe o
 * alumno. Devuelve { chatId } para abrirlo en /admin/chats?chat=<id>.
 */
export const dynamic = "force-dynamic";

const Body = z.object({ userId: z.string().uuid() });

export async function POST(req: Request) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const me = (session.user as { id: string }).id;
  if (parsed.data.userId === me) return NextResponse.json({ error: "self" }, { status: 400 });
  const chatId = await ensureDirectChat(me, parsed.data.userId);
  return NextResponse.json({ chatId });
}
