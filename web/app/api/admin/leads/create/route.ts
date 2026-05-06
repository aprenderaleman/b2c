import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

/**
 * POST /api/admin/leads/create
 *
 * Crea un lead manualmente (cuando llega por canal no funnel — Instagram
 * DM, referido, llamada, etc.). Si ya existe un lead con el mismo
 * whatsapp_normalized devuelve 409 para evitar duplicados.
 *
 * Auth: admin / superadmin.
 */
const Body = z.object({
  name:                z.string().trim().min(1).max(120),
  email:               z.string().trim().email().max(160).nullable().optional(),
  whatsapp_normalized: z.string().trim().min(4).max(40),
  whatsapp_country:    z.string().trim().regex(/^\+?\d{1,4}$/).optional(),
  language:            z.enum(["es","de"]).default("es"),
  german_level:        z.enum(["A0","A1-A2","B1","B2+"]).nullable().optional(),
  goal:                z.string().trim().max(40).nullable().optional(),
  source:              z.string().trim().max(40).optional(),    // "manual", "instagram", "referido"…
  initial_note:        z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  // Normalise phone
  const cc = (b.whatsapp_country?.replace("+","") ?? "49");
  let phone: string;
  try { phone = normalizePhone(b.whatsapp_normalized, cc); }
  catch (e) { return NextResponse.json({ error: "phone_invalid", message: e instanceof Error ? e.message : "invalid" }, { status: 400 }); }

  const sb = supabaseAdmin();

  // Dedup por whatsapp_normalized
  const { data: existing } = await sb
    .from("leads")
    .select("id, name, status")
    .eq("whatsapp_normalized", phone)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      error: "lead_already_exists",
      lead_id: (existing as { id: string }).id,
      reason: `Ya hay un lead con ese WhatsApp: ${(existing as { name: string }).name} (${(existing as { status: string }).status})`,
    }, { status: 409 });
  }

  const { data: lead, error } = await sb
    .from("leads")
    .insert({
      name:                b.name,
      email:               b.email?.toLowerCase() ?? null,
      whatsapp_normalized: phone,
      language:            b.language,
      german_level:        b.german_level ?? null,
      goal:                b.goal ?? null,
      status:              "new",
      source:              b.source ?? "manual",
    })
    .select("id")
    .single();
  if (error || !lead) return NextResponse.json({ error: "lead_create_failed", message: error?.message }, { status: 500 });

  // Audit en lead_timeline
  await sb.from("lead_timeline").insert({
    lead_id: (lead as { id: string }).id,
    type:    "agent_note",
    author:  "gelfis",
    content: `Lead creado manualmente desde /admin/leads.${b.initial_note ? `\nNota: ${b.initial_note}` : ""}`,
  });

  return NextResponse.json({ ok: true, lead_id: (lead as { id: string }).id });
}
