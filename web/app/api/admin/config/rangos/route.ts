import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("config_rangos")
    .select("*")
    .order("rol")
    .order("comision_pct");

  return NextResponse.json({ rows: data ?? [] });
}

const UpdateRow = z.object({
  id: z.number().int(),
  rol: z.enum(["teacher", "closer"]),
  rango: z.string().min(1).max(50),
  comision_pct: z.number().min(0).max(100),
  min_close_rate: z.number().min(0).max(100),
  min_conversiones: z.number().int().min(0),
});

const Body = z.object({
  rows: z.array(UpdateRow),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  for (const row of parsed.data.rows) {
    await sb.from("config_rangos").upsert({
      id: row.id,
      rol: row.rol,
      rango: row.rango,
      comision_pct: row.comision_pct,
      min_close_rate: row.min_close_rate,
      min_conversiones: row.min_conversiones,
    });
  }

  return NextResponse.json({ ok: true });
}
