import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { canAccessChat } from "@/lib/chat";
import { refreshSignedUrl } from "@/lib/storage";

/**
 * GET /api/chat/attachment?m=<message_id>&i=<index>
 *
 * Re-firma al vuelo el adjunto de un mensaje de chat y redirige a la URL
 * fresca. Motivo (Sabine 2026-10-27): los adjuntos se guardaban como URL
 * firmada de Supabase con TTL de 7 días — pasada una semana el enlace
 * moría y los PDFs antiguos dejaban de abrirse. El chat ahora enlaza
 * SIEMPRE a este endpoint, que comprueba que el usuario participa en el
 * chat y emite una firma nueva de 1 hora. Funciona también para todos
 * los adjuntos históricos (el path se extrae de la URL guardada).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const messageId = u.searchParams.get("m") ?? "";
  const index = Number.parseInt(u.searchParams.get("i") ?? "", 10);
  if (!messageId || !Number.isInteger(index) || index < 0 || index > 50) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: msg } = await sb
    .from("messages")
    .select("chat_id, attachments, deleted")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || (msg as { deleted: boolean }).deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role?: string }).role;
  const isAdmin = role === "admin" || role === "superadmin";
  if (!isAdmin && !(await canAccessChat((msg as { chat_id: string }).chat_id, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const atts = ((msg as { attachments: unknown }).attachments ?? []) as Array<{ url?: string }>;
  const stored = atts[index]?.url;
  if (!stored) return NextResponse.json({ error: "attachment_not_found" }, { status: 404 });

  // Path dentro del bucket: lo que va tras /object/sign/chat-uploads/
  // (URLs firmadas históricas) o /object/public/chat-uploads/.
  const m = stored.match(/\/object\/(?:sign|public)\/chat-uploads\/([^?]+)/);
  if (!m) return NextResponse.json({ error: "unsupported_url" }, { status: 422 });
  const path = decodeURIComponent(m[1]);

  const fresh = await refreshSignedUrl("chat-uploads", path);
  if (!fresh) return NextResponse.json({ error: "sign_failed" }, { status: 500 });

  return NextResponse.redirect(fresh, 302);
}
