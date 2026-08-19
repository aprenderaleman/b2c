import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/groups  → create a new student_group.
 * Admin-only.
 */
export const runtime = "nodejs";

const Body = z.object({
  name:         z.string().trim().min(2).max(200),
  class_type:   z.enum(["group", "individual"]).default("individual"),
  level:        z.enum(["A0","A1","A2","B1","B2","C1","C2"]).nullable().optional(),
  teacher_id:   z.string().uuid().nullable().optional(),
  // URLs: aceptamos string libre + normalizamos abajo (auto-prepend
  // https:// si falta). El .url() estricto rechazaba copy-paste de
  // Google Docs sin esquema y la UI solo mostraba "Error al guardar".
  meet_link:    z.string().trim().max(500).nullable().optional(),
  document_url: z.string().trim().max(500).nullable().optional(),
  capacity:     z.coerce.number().int().min(1).max(50).default(10),
  notes:        z.string().trim().max(2000).nullable().optional(),
  total_sessions: z.coerce.number().int().min(1).max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  // Auto-prepend https:// si falta esquema (Google Docs share links se
  // copian sin scheme con frecuencia).
  const normalizeUrl = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const s = v.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return `https://${s}`;
  };

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("student_groups").insert({
    name:         b.name,
    class_type:   b.class_type,
    level:        b.level ?? null,
    teacher_id:   b.teacher_id ?? null,
    meet_link:    normalizeUrl(b.meet_link),
    document_url: normalizeUrl(b.document_url),
    capacity:     b.capacity,
    notes:        b.notes ?? null,
    total_sessions: b.total_sessions ?? null,
    active:       true,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
