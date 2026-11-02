import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";

/**
 * POST /api/setter/profile — el setter completa sus datos de pago y
 * contacto (Gelfis 2026-11-02): IBAN (para su nómina) y teléfono.
 * Solo actualiza su PROPIA fila de users.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  iban: z.string().trim().max(42).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(req: Request) {
  const setter = await resolveSetterActor();
  if (!setter) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 400 });
  }

  const update: Record<string, string> = {};

  if (parsed.data.iban !== undefined) {
    const iban = parsed.data.iban.replace(/\s+/g, "").toUpperCase();
    if (iban.length > 0) {
      // Validación básica de forma (país + 2 dígitos de control + BBAN).
      if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) {
        return NextResponse.json({ ok: false, error: "iban_invalido" }, { status: 400 });
      }
      update.iban = iban;
    }
  }
  if (parsed.data.phone !== undefined && parsed.data.phone.trim().length > 0) {
    update.phone = parsed.data.phone.trim();
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "nada_que_guardar" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("users").update(update).eq("id", setter.id);
  if (error) {
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: Object.keys(update) });
}
