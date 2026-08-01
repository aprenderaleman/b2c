import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "La nueva contrasena debe tener al menos 8 caracteres"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = (session.user as { id: string }).id;

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
    .eq("id", closerId)
    .single();

  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.password_hash as string);
  if (!valid) {
    return NextResponse.json({ error: "wrong_password", message: "La contrasena actual es incorrecta." }, { status: 400 });
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await sb
    .from("users")
    .update({ password_hash: newHash, must_change_password: false })
    .eq("id", closerId);

  return NextResponse.json({ ok: true });
}
