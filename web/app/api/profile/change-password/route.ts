import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/profile/change-password — cambio de contraseña self-service
 * para CUALQUIER rol logueado (Gelfis 2026-10-29, caso Adrián: no había
 * ninguna vía de cambiar la contraseña salvo el email de reset).
 * Generaliza /api/closer/profile/change-password (que queda como está
 * por compatibilidad). Exige la contraseña actual, así que un admin
 * impersonando no puede cambiarla sin conocerla.
 */
export const runtime = "nodejs";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "La nueva contraseña debe tener al menos 8 caracteres"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: user } = await sb
    .from("users")
    .select("password_hash")
    .eq("id", userId)
    .single();
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const valid = await bcrypt.compare(parsed.data.currentPassword, (user.password_hash as string) ?? "");
  if (!valid) {
    return NextResponse.json({ error: "wrong_password", message: "La contraseña actual es incorrecta." }, { status: 400 });
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  const { error } = await sb
    .from("users")
    .update({ password_hash: newHash, must_change_password: false })
    .eq("id", userId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
