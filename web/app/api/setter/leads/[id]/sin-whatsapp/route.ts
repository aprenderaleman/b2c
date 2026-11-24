import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { registerContact } from "@/lib/contacts";

/**
 * POST /api/setter/leads/[id]/sin-whatsapp — botón "🚫 No tiene WA"
 * (Gelfis 2026-11-25). Para leads que escribieron mal su número o no
 * tienen WhatsApp:
 *   - leads.sin_whatsapp = true → el lead sale de las listas del setter
 *     (urgentes y no-shows) y el profe ve el tag en su ficha.
 *   - Queda registrado como nota en el historial del lead.
 * El lead NO se descarta: su cita sigue y los emails le siguen llegando.
 *
 * Body: { note: string (min 5) }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().trim().min(5).max(2000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const setter = await resolveSetterActor();
  if (!setter) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id: leadId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "nota_corta" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads").select("id, sin_whatsapp").eq("id", leadId).maybeSingle();
  if (!leadRow) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });

  const { error: upErr } = await sb
    .from("leads").update({ sin_whatsapp: true }).eq("id", leadId);
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  // Historial — visible para admin, profe y closer en la ficha.
  const contact = await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "nota_libre",
    channel: "otro",
    note: `🚫 No tiene WhatsApp (número mal escrito o inexistente). ${parsed.data.note}`,
  });
  if (!contact.ok) {
    console.error("[sin-whatsapp] contacto no registrado:", contact.error);
  }

  return NextResponse.json({ ok: true });
}
