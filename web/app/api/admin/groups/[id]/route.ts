import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/groups/{id}  → update group fields.
 * DELETE /api/admin/groups/{id} → soft-delete (active=false).
 * Admin-only.
 */
export const runtime = "nodejs";

const CEFR = z.enum(["A0","A1","A2","B1","B2","C1","C2"]);

const Body = z.object({
  name:         z.string().trim().min(2).max(200).optional(),
  class_type:   z.enum(["group", "individual"]).optional(),
  level:        CEFR.nullable().optional(),
  /** Multi-level support. Source of truth; legacy `level` is kept in
   *  sync to the first array element so older queries still work. */
  levels:       z.array(CEFR).max(7).optional(),
  teacher_id:   z.string().uuid().nullable().optional(),
  // URLs: aceptamos string libre, no validamos formato. Antes con
  // `.url()` estricto el Zod rechazaba URLs sin esquema (típico al
  // copiar de Google Docs sin "https://") y la UI solo mostraba
  // "Error al guardar". El normalizador de abajo añade el esquema
  // si falta. Riesgo XSS no aplica: el valor se usa solo en href.
  meet_link:    z.string().trim().max(500).nullable().optional().or(z.literal("")),
  document_url: z.string().trim().max(500).nullable().optional().or(z.literal("")),
  capacity:     z.coerce.number().int().min(1).max(50).optional(),
  notes:        z.string().trim().max(2000).nullable().optional(),
  active:       z.boolean().optional(),
  /** Target total of sessions the group commits to (e.g. 50). NULL clears
   *  it. Bumped automatically by the extend-series endpoint. */
  total_sessions: z.coerce.number().int().min(1).max(500).nullable().optional(),
}).refine(b => Object.keys(b).length > 0, { message: "no_changes" });

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { err: null };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin();
  if (err) return err;
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  // Normalise URL fields:
  //   empty/whitespace → null
  //   sin esquema (ej. "docs.google.com/..." al copy-paste) → prepend
  //   "https://" para que href funcione correctamente.
  const normalizeUrl = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return `https://${s}`;
  };
  const update: Record<string, unknown> = { ...b };
  if ("meet_link"    in b) update.meet_link    = normalizeUrl(b.meet_link);
  if ("document_url" in b) update.document_url = normalizeUrl(b.document_url);

  // If `levels` is provided, keep the legacy single-column `level` in sync
  // with the first array element (or null if the array is empty) so older
  // UI / SQL that still reads `level` doesn't lie.
  if (Array.isArray(b.levels)) {
    update.level = b.levels[0] ?? null;
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("student_groups").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin();
  if (err) return err;
  const { id } = await params;

  const sb = supabaseAdmin();
  const { error } = await sb.from("student_groups").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
