import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

/**
 * POST /api/admin/leads/[id]/update
 *
 * Manual editor for the admin's lead detail page. Lets Gelfis fix the
 * fields that come through wrong from the public funnel — most often
 * the WhatsApp number (e.g. lead typed +34 in the country picker AND
 * "34..." in the phone field, ending up with "+3434..."), but also
 * the name, email, language and qualifying answers.
 *
 * The phone is re-run through `normalizePhone` server-side so the
 * stored value always matches our canonical E.164 shape; if the
 * normaliser rejects the input we fail fast with `phone_invalid`.
 *
 * Every change is logged to `lead_timeline` as an `agent_note` with
 * author 'gelfis' and a metadata diff (old → new) for auditability.
 */

const Body = z.object({
  name:                z.string().trim().min(1).max(120).nullable().optional(),
  email:               z.string().trim().email().nullable().optional(),
  whatsapp_normalized: z.string().trim().min(4).max(40).nullable().optional(),
  whatsapp_country:    z.string().trim().regex(/^\+?\d{1,4}$/).optional(),
  language:            z.enum(["es", "de"]).optional(),
  // Sincronizado con el enum `german_level` de Postgres (ver
  // db/migrations/000_init.sql + sucesivos ALTER TYPE). Incluye los
  // niveles "limpios" (A1, A2, C1) además de los sub-niveles y los
  // legacy "A1-A2", "B2+", "unsure" — si añades un nuevo nivel al
  // enum de la DB, añádelo también aquí o el modal de edición caerá
  // en validation_failed silenciosamente.
  german_level:        z.enum([
    "A0", "A1", "A1.1", "A1.2", "A1-A2",
    "A2", "A2.1", "A2.2",
    "B1", "B2", "B2+", "C1",
    "unsure",
  ]).nullable().optional(),
  // Mismo enum que `lead_goal` en Postgres. Antes era z.string() lo
  // que dejaba colar valores que la DB rechazaba con 500. Ahora
  // validamos contra los mismos enum values.
  goal:                z.enum([
    "work", "visa", "studies", "exam",
    "travel", "already_in_dach", "personal_growth",
  ]).nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const sb = supabaseAdmin();

  // Pull current values for the diff (and to detect collisions).
  const { data: cur, error: getErr } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, german_level, goal")
    .eq("id", id)
    .maybeSingle();
  if (getErr || !cur) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Re-normalise the phone if provided. The default country is taken
  // from the explicit `whatsapp_country` field if present; otherwise
  // we fall back to the prefix already in DB or the funnel default
  // (49 — DACH-first).
  let normalisedPhone: string | null | undefined = body.whatsapp_normalized;
  if (body.whatsapp_normalized !== undefined && body.whatsapp_normalized !== null) {
    const defaultCC = (body.whatsapp_country?.replace("+", "") ?? "49");
    try {
      normalisedPhone = normalizePhone(body.whatsapp_normalized, defaultCC);
    } catch (e) {
      return NextResponse.json(
        { error: "phone_invalid", message: e instanceof Error ? e.message : "invalid phone" },
        { status: 400 },
      );
    }
    // Block accidental overlap with another lead (whatsapp_normalized
    // is a soft business key for the agents pipeline).
    if (normalisedPhone !== cur.whatsapp_normalized) {
      const { data: collision } = await sb
        .from("leads")
        .select("id")
        .eq("whatsapp_normalized", normalisedPhone)
        .neq("id", id)
        .maybeSingle();
      if (collision) {
        return NextResponse.json(
          { error: "phone_already_used_by_another_lead", other_lead_id: (collision as { id: string }).id },
          { status: 409 },
        );
      }
    }
  }

  // Build the patch with only fields actually sent.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const setIfChanged = (key: string, oldValue: unknown, newValue: unknown) => {
    if (newValue === undefined) return;
    if (newValue !== oldValue) {
      patch[key] = newValue;
      diff[key]  = { from: oldValue, to: newValue };
    }
  };
  setIfChanged("name",                body.name              ?? cur.name,         body.name);
  setIfChanged("email",               body.email             ?? cur.email,        body.email);
  setIfChanged("whatsapp_normalized", cur.whatsapp_normalized,                    normalisedPhone);
  setIfChanged("language",            body.language          ?? cur.language,     body.language);
  setIfChanged("german_level",        body.german_level      ?? cur.german_level, body.german_level);
  setIfChanged("goal",                body.goal              ?? cur.goal,         body.goal);

  if (Object.keys(diff).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: upErr } = await sb.from("leads").update(patch).eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: "update_failed", message: upErr.message }, { status: 500 });
  }

  // Audit trail — one timeline note per edit, with the diff embedded.
  const summary = Object.entries(diff)
    .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
    .join("\n");
  await sb.from("lead_timeline").insert({
    lead_id: id,
    type:    "agent_note",
    author:  "gelfis",
    content: `Edición manual del lead:\n${summary}`,
    metadata: { diff },
  });

  // ── Auto-pausa Stiv si cambió el WhatsApp ──
  // Caso patrón observado: lead pone WA mal → Gelfis corrige → Gelfis
  // escribe manualmente al lead → Stiv NO se entera de la conversa
  // → Stiv sigue mandando drips ciegos al lead que ya está hablando
  // con Gelfis. Solución: al detectar cambio de WhatsApp, pausamos
  // Stiv 12h para que el manual takeover de Gelfis no compita con
  // mensajes automáticos. Gelfis decide cuándo reactivar.
  if (diff.whatsapp_normalized) {
    const pauseUntil = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
    await sb.from("leads").update({ ai_paused_until: pauseUntil }).eq("id", id);
    await sb.from("lead_timeline").insert({
      lead_id: id,
      type:    "agent_note",
      author:  "gelfis",
      content: `📵 Stiv pausado 12h tras corrección de WhatsApp — toma tú el control manual`,
      metadata: { kind: "ai_auto_paused_on_phone_edit", paused_until: pauseUntil },
    });
    const { createAdminNotification } = await import("@/lib/admin-notifications");
    const leadName = (cur as { name?: string }).name ?? "(sin nombre)";
    await createAdminNotification({
      type: "ai_paused_phone_edit",
      severity: "info",
      title: `📵 Stiv pausado 12h en lead ${leadName}`,
      body: `Cambiaste el WhatsApp del lead — Stiv calla 12h para no competir con tu takeover manual. Reactívalo cuando termines.`,
      lead_id: id,
      action_url: `/admin/leads/${id}`,
      metadata: { paused_until: pauseUntil, diff: diff.whatsapp_normalized },
      dedupeHours: false,
    });
  }

  // ── Auto-reenvío de confirmación si cambió el WhatsApp ──
  // Caso real Juan José 2026-05-08: doble +34 → falló confirmación →
  // admin corrigió el número → nadie reenvió → lead se queda sin
  // WhatsApp para siempre. Ahora lo cubrimos automáticamente.
  if (diff.whatsapp_normalized && cur.whatsapp_normalized !== diff.whatsapp_normalized.to) {
    try {
      const { data: lastFailures } = await sb
        .from("lead_timeline")
        .select("timestamp, metadata")
        .eq("lead_id", id)
        .eq("type", "send_failed")
        .order("timestamp", { ascending: false })
        .limit(20);
      const lastFail = (lastFailures ?? []).find(r => {
        const m = r.metadata as { kind?: string } | null;
        return m?.kind === "trial_confirmation";
      });
      if (lastFail) {
        // Verificar que no se ha resuelto ya
        const { data: succ } = await sb
          .from("lead_timeline")
          .select("metadata")
          .eq("lead_id", id)
          .eq("type", "system_message_sent")
          .gte("timestamp", lastFail.timestamp);
        const alreadyOk = (succ ?? []).some(r => {
          const m = r.metadata as { kind?: string; channel?: string } | null;
          return m?.channel === "whatsapp" &&
            (m.kind === "trial_confirmation" || m.kind === "trial_confirmation_resend");
        });
        if (!alreadyOk) {
          // Disparar el endpoint de reenvío internamente. No bloqueamos
          // la respuesta — best-effort: si falla, el banner del panel
          // seguirá visible y el admin puede clicar manualmente.
          const proto = req.headers.get("x-forwarded-proto") ?? "https";
          const host = req.headers.get("host");
          const internalUrl = host ? `${proto}://${host}/api/admin/leads/${id}/resend-confirmation` : null;
          if (internalUrl) {
            // Reusamos la cookie del request para autenticarnos en el
            // endpoint admin (NextAuth session pasa por cookies).
            const cookie = req.headers.get("cookie") ?? "";
            // No esperamos la respuesta — fire-and-forget.
            fetch(internalUrl, { method: "POST", headers: { cookie } }).catch(() => {});
          }
        }
      }
    } catch (e) {
      // No bloqueante. El admin verá el banner y puede reenviar manualmente.
      console.error("[lead-update] auto-resend hook failed:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, changed: true, diff });
}
