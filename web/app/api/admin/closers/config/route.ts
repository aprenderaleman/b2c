import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { invalidateConfigCopys, CLOSER_COPY_REAGENDA_DEFAULT } from "@/lib/config-copys";

/**
 * CRM Closer F4+F7 (Gelfis 2026-11-25) — ajustes del CRM del closer en
 * system_config, editables desde /admin/closers sin deploy:
 *
 *   closer_welcome_doc_url  URL del documento de bienvenida (email de alta)
 *   closer_copy_reagenda    copy del WhatsApp de reagenda ({nombre}, {enlace})
 */

const KEYS = ["closer_welcome_doc_url", "closer_copy_reagenda"] as const;

const Body = z.object({
  closer_welcome_doc_url: z.string().trim().max(500).optional(),
  closer_copy_reagenda: z.string().trim().max(2000).optional(),
});

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return null;
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") return null;
  return session.user;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("system_config")
    .select("key, value")
    .in("key", [...KEYS]);
  const values: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
    if (row.value) values[row.key] = row.value;
  }
  return NextResponse.json({
    ok: true,
    values,
    defaults: { closer_copy_reagenda: CLOSER_COPY_REAGENDA_DEFAULT },
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const docUrl = parsed.data.closer_welcome_doc_url;
  if (docUrl && !/^https?:\/\//.test(docUrl)) {
    return NextResponse.json({ error: "url_invalida", message: "La URL debe empezar por http(s)://" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  for (const key of KEYS) {
    const value = parsed.data[key];
    if (value === undefined) continue;          // campo no enviado: no tocar
    if (value === "") {
      await sb.from("system_config").delete().eq("key", key);   // vacío = volver al default
    } else {
      await sb.from("system_config").upsert({ key, value, updated_at: new Date().toISOString() });
    }
  }
  invalidateConfigCopys();

  return NextResponse.json({ ok: true });
}
