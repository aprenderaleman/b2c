import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/leads/[id]/ai-pause
 *
 * Toggles Stiv (the AI WhatsApp assistant) for this single lead.
 *
 * Body:
 *   { paused: true,  hours?: number }   — pause for `hours` (default 24)
 *   { paused: false }                   — clear pause, AI free to reply again
 *
 * The endpoint is intentionally idempotent — calling pause twice just
 * extends the timer. We DO NOT change `lead.status`, so funnel
 * counters, follow-up scheduling and conversion logic stay intact;
 * Stiv just stays silent while the admin handles the chat in person.
 *
 * Form-style requests redirect back to the lead page (used by the
 * inline button); JSON requests get a JSON response.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Accept either JSON or form-data so the same endpoint serves the
  // inline button (form post) and any future programmatic clients.
  let paused = false;
  let hours  = 24;
  let takeoverNote = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    paused = Boolean(body?.paused);
    hours  = Number.isFinite(body?.hours) ? Number(body.hours) : 24;
    takeoverNote = String(body?.note ?? "").trim();
  } else {
    const form = await req.formData().catch(() => null);
    paused = form?.get("paused") === "true" || form?.get("paused") === "1";
    const h = Number(form?.get("hours"));
    if (Number.isFinite(h) && h > 0) hours = h;
    takeoverNote = String(form?.get("note") ?? "").trim();
  }

  const value = paused
    ? new Date(Date.now() + hours * 3600_000).toISOString()
    : null;

  const sb = supabaseAdmin();

  // Si el admin está REACTIVANDO Stiv (paused=false) y dejó una nota,
  // guárdala en gelfis_notes ANTES de limpiar la pausa. agent_1 la
  // recoge en la próxima respuesta. Decisión Gelfis 2026-05-04: el bot
  // necesita contexto humano para no responder a ciegas tras un takeover.
  if (!paused && takeoverNote.length > 0) {
    await sb.from("gelfis_notes").insert({
      lead_id: id,
      note:    `[Takeover handoff] ${takeoverNote}`,
    });
  }

  const { error } = await sb
    .from("leads")
    .update({ ai_paused_until: value })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Note in the timeline so the chronology shows who paused/resumed.
  // Para reactivaciones, incluimos en el content si hubo nota o no — eso
  // permite que agent_1 detecte "reactivación reciente" en el timeline
  // y eleve la atención del LLM a las gelfis_notes.
  await sb.from("lead_timeline").insert({
    lead_id: id,
    type:    "agent_note",
    author:  "admin",
    content: paused
      ? `Stiv pausado ${hours}h — admin toma la conversación manual.`
      : (takeoverNote
          ? `Stiv reactivado con nota de handoff. Bot debe leer gelfis_notes antes de responder.`
          : `Stiv reactivado SIN nota de handoff — bot puede no tener contexto del takeover.`),
  });

  if (ct.includes("application/json")) {
    return NextResponse.json({ ok: true, paused, until: value });
  }
  return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
}
