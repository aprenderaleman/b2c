import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { listTrialSlots } from "@/lib/trial-slots";
import { buildTrialToken } from "@/lib/trial-token";
import { sendTrialConfirmationEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/public/book-trial
 *
 * Public endpoint hit by the funnel's last step. Body:
 *   {
 *     name, email, whatsapp_e164 (optional), whatsapp_raw (optional),
 *     german_level, goal, language,
 *     slot_iso, teacher_id
 *   }
 *
 * Behaviour:
 *   1. If a USER already exists with this email → "already registered"
 *      (per Gelfis: existing students log in, they don't re-book trials).
 *   2. Re-validate the slot is still free. If two leads race for it,
 *      the second sees "ese horario acaba de reservarse, elige otro".
 *   3. Upsert the LEAD (no user/student row created — that happens at
 *      payment time). Mark status='trial_scheduled' + trial_scheduled_at.
 *   4. Create the trial CLASS (is_trial=true, lead_id, livekit_room_id).
 *      No class_participants row — the lead joins via magic link.
 *   5. Send confirmation: email (Resend/SMTP) + WhatsApp (Evolution).
 *      Both fire-and-forget so a 1-channel hiccup doesn't fail the
 *      whole booking.
 *   6. Return { ok, classId, magicLinkUrl } — the funnel uses these
 *      to render the confirmation screen.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const TRIAL_DURATION_MIN = 45;

// WhatsApp is required: the teacher confirms the class + shares the
// material via WhatsApp, and the lead is told this in the funnel
// disclaimer ("only educational purposes").
const Body = z.object({
  name:           z.string().trim().min(2).max(100),
  email:          z.string().trim().toLowerCase().email(),
  whatsapp_e164:  z.string().trim().min(8, "WhatsApp requerido"),
  whatsapp_raw:   z.string().trim().min(4).nullable().optional(),
  german_level:   z.enum(["A0", "A1-A2", "B1", "B2+"]).nullable().optional(),
  goal:           z.string().trim().max(60).nullable().optional(),
  language:       z.enum(["es", "de"]).default("es"),
  slot_iso:       z.string().datetime(),
  teacher_id:     z.string().uuid(),
});

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.error("[book-trial] validation_failed", {
      raw,
      fieldErrors: flat.fieldErrors,
      formErrors:  flat.formErrors,
    });
    // Build a human-readable summary so the funnel can surface it.
    const fieldMessages = Object.entries(flat.fieldErrors)
      .map(([k, msgs]) => `${k}: ${(msgs ?? []).join(", ")}`)
      .join(" · ");
    return NextResponse.json(
      {
        error:   "validation_failed",
        message: fieldMessages || "Datos inválidos",
        details: flat,
      },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const sb = supabaseAdmin();

  // ── 1. Already a registered student? Reject.
  const { data: existingUser } = await sb
    .from("users")
    .select("id, email, role")
    .eq("email", b.email)
    .maybeSingle();
  if (existingUser) {
    return NextResponse.json({
      error:   "already_registered",
      message: "Ya estás registrado. Inicia sesión y agenda desde tu panel.",
      login_url: `${PLATFORM_URL}/login`,
    }, { status: 409 });
  }

  // ── 2. Re-validate the slot is still in the available list.
  const slots = await listTrialSlots();
  const match = slots.find(s =>
    s.startIso === b.slot_iso && s.teacherId === b.teacher_id);
  if (!match) {
    return NextResponse.json({
      error:   "slot_taken",
      message: "Ese horario acaba de reservarse o dejó de estar disponible. Elige otro.",
    }, { status: 409 });
  }

  // ── 3. Upsert the lead.
  // Match by email FIRST. If no email match and the lead provided their
  // WhatsApp number, also try to match by `whatsapp_normalized` — this
  // catches the legacy WhatsApp-first lead who later self-books via the
  // funnel; without this we'd create a duplicate row.
  const orFilters: string[] = [`email.eq.${b.email}`];
  if (b.whatsapp_e164) {
    orFilters.push(`whatsapp_normalized.eq.${b.whatsapp_e164}`);
  }
  const { data: existingLead } = await sb
    .from("leads")
    .select("id, email, whatsapp_normalized")
    .or(orFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // `goal` is NOT NULL on `leads` — fall back if the funnel ever
  // forgets to send one. Same for `urgency`, where booking a trial
  // implies they're moving fast → "asap" is the right default. The
  // column doesn't exist on our funnel UI; admin can refine later.
  const goal    = b.goal ?? "travel";
  const urgency = "asap";

  let leadId: string;
  if (existingLead) {
    const existing = existingLead as {
      id: string;
      email: string | null;
      whatsapp_normalized: string | null;
    };
    leadId = existing.id;
    // Preserve any contact info we already had — only fill blanks.
    // (e.g. legacy WhatsApp-first lead now booking with their email →
    // we want to keep both channels, not overwrite the WhatsApp.)
    await sb.from("leads").update({
      name:                 b.name,
      email:                existing.email ?? b.email,
      whatsapp_normalized:  existing.whatsapp_normalized ?? b.whatsapp_e164  ?? null,
      whatsapp_raw:         existing.whatsapp_normalized ? undefined : (b.whatsapp_raw ?? null),
      german_level:         b.german_level   ?? null,
      goal,
      urgency,
      language:             b.language,
      status:               "trial_scheduled",
      trial_scheduled_at:   b.slot_iso,
      gdpr_accepted:        true,
      gdpr_accepted_at:     new Date().toISOString(),
      source:               "funnel_trial_self_book",
    }).eq("id", leadId);
  } else {
    const { data: newLead, error: insErr } = await sb.from("leads").insert({
      name:                 b.name,
      email:                b.email,
      whatsapp_normalized:  b.whatsapp_e164  ?? null,
      whatsapp_raw:         b.whatsapp_raw   ?? null,
      german_level:         b.german_level   ?? null,
      goal,
      urgency,
      language:             b.language,
      status:               "trial_scheduled",
      trial_scheduled_at:   b.slot_iso,
      gdpr_accepted:        true,
      gdpr_accepted_at:     new Date().toISOString(),
      source:               "funnel_trial_self_book",
    }).select("id").single();
    if (insErr || !newLead) {
      return NextResponse.json({
        error: "lead_create_failed",
        message: insErr?.message ?? "unknown",
      }, { status: 500 });
    }
    leadId = (newLead as { id: string }).id;
  }

  // ── 4. Create the trial class.
  const teacherFirst = (match.teacherName.split(/\s+/)[0]) || match.teacherName;
  const classTitle = `Clase de prueba — ${b.name.split(/\s+/)[0]} (${teacherFirst})`;
  const { data: cls, error: classErr } = await sb.from("classes").insert({
    type:               "individual",
    teacher_id:         b.teacher_id,
    scheduled_at:       b.slot_iso,
    duration_minutes:   TRIAL_DURATION_MIN,
    title:              classTitle,
    topic:              b.goal ?? null,
    status:             "scheduled",
    is_trial:           true,
    lead_id:            leadId,
    notes_admin:        `auto-booked via funnel · level=${b.german_level ?? "?"}`,
  }).select("id").single();
  if (classErr || !cls) {
    return NextResponse.json({
      error: "class_create_failed",
      message: classErr?.message ?? "unknown",
    }, { status: 500 });
  }
  const classId = (cls as { id: string }).id;

  // ── 5. Magic-link URL + side-channel notifications.
  const token = buildTrialToken(leadId, classId);
  const magicLinkUrl = `${PLATFORM_URL}/trial/${classId}?t=${encodeURIComponent(token)}`;

  const startDate = new Date(b.slot_iso).toLocaleString(b.language === "de" ? "de-DE" : "es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  }) + (b.language === "de" ? " (Berlin)" : " (Berlín)");

  // Email — wait for it to land so the user sees a friendlier error if
  // it fails (we still keep the booking, but tell them the email might
  // be late so they bookmark the magic-link page).
  sendTrialConfirmationEmail(b.email, {
    leadName:    b.name.split(/\s+/)[0] || b.name,
    classTitle,
    startDate,
    durationMin: TRIAL_DURATION_MIN,
    teacherName: match.teacherName,
    joinUrl:     magicLinkUrl,
    language:    b.language,
  }).catch(e => console.error("[book-trial] email failed:", e));

  // WhatsApp — only if the lead provided their number. Kept short
  // intentionally: full details live in the email; here we only need
  // the join link + a soft ask to confirm attendance so the lead
  // engages and we know to expect them.
  if (b.whatsapp_e164) {
    const leadFirst = b.name.split(/\s+/)[0] || b.name;
    const waText =
      b.language === "de"
        ? `✅ ${leadFirst}, deine Probestunde ist bestätigt.\n\n📅 ${startDate}\n👤 ${match.teacherName} · 45 Min\n🔗 ${magicLinkUrl}\n\nKannst du mir mit "Sí" oder "Ja" bestätigen, dass du dabei bist? 🙌\n\n— Aprender-Aleman.de`
        : `✅ ${leadFirst}, tu clase de prueba está confirmada.\n\n📅 ${startDate}\n👤 ${match.teacherName} · 45 min\n🔗 ${magicLinkUrl}\n\n¿Me confirmas con un "Sí" que asistirás? 🙌\n\n— Aprender-Aleman.de`;
    sendWhatsappText(b.whatsapp_e164, waText)
      .catch(e => console.error("[book-trial] whatsapp failed:", e));
  }

  return NextResponse.json({
    ok:        true,
    classId,
    // Token returned separately so the funnel can redirect to a
    // standalone /confirmacion?c=...&t=... page instead of rendering
    // the success screen inline.
    token,
    teacherName: match.teacherName,
    startDate,
    magicLinkUrl,
  });
}
