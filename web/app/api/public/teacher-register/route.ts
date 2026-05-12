import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { createUser } from "@/lib/users";
import { sanitizeE164 } from "@/lib/phone";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import {
  validateInvitation,
  consumeInvitation,
} from "@/lib/teacher-invitations";

/**
 * POST /api/public/teacher-register
 *
 * Endpoint público del auto-registro de profesores. Body:
 *
 *   {
 *     code:            "<invitation_code>",
 *     name:            "Sabine Arning",
 *     email:           "sabine@example.com",
 *     whatsapp_e164:   "+49152...",
 *     whatsapp_raw:    "+49 152 ...",
 *     address:         "...",
 *     country:         "DE",
 *     languages:       "Alemán nativo, Español B2",
 *     specialties:     "Gramática A1-A2, conversación B1",
 *     levels:          ["A1","A2","B1"],
 *     rate_group:      35,
 *     rate_individual: 45,
 *     iban:            "ES00...",
 *     gdpr_accepted:   true
 *   }
 *
 * Comportamiento:
 *   1. Rate-limit por IP (5/h).
 *   2. Validar Zod.
 *   3. Validar el invitation code → existe, no usada, no revocada,
 *      no expirada.
 *   4. Verificar email único en `users`.
 *   5. createUser({ role:"teacher", inactive:true,
 *      teacherProfile:{ registeredSelf:true, ...campos } }).
 *   6. consumeInvitation(code, userId) con race-guard.
 *   7. Notificación in-app a TODOS los superadmins
 *      (type=teacher_pending_approval).
 *   8. NO se manda welcome email — eso espera a que admin apruebe.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const Body = z.object({
  code:             z.string().trim().min(8).max(64),
  name:             z.string().trim().min(2).max(120),
  email:            z.string().trim().toLowerCase().email(),
  whatsapp_e164:    z.string().trim().regex(/^\+?[0-9]{8,15}$/),
  whatsapp_raw:     z.string().trim().max(40).optional(),
  address:          z.string().trim().min(4).max(300),
  country:          z.string().trim().length(2).toUpperCase(),
  languages:        z.string().trim().min(2).max(500),
  specialties:      z.string().trim().min(2).max(500),
  levels:           z.array(z.enum(["A0","A1","A2","B1","B2","C1","C2"])).min(1),
  rate_group:       z.coerce.number().positive().max(500),
  rate_individual:  z.coerce.number().positive().max(500),
  iban:             z.string().trim().min(10).max(40),
  gdpr_accepted:    z.literal(true, { errorMap: () => ({ message: "Aceptación GDPR obligatoria" }) }),
});

export async function POST(req: NextRequest) {
  const ip = ipFromHeaders(req);
  const rl = await checkRateLimit({
    scope:    "teacher_register",
    key:      ip,
    max:      5,
    windowMs: 60 * 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const whatsapp = sanitizeE164(b.whatsapp_e164);

  const sb = supabaseAdmin();

  // 1. Validar el invitation code (existe + no consumido + no expirado).
  const v = await validateInvitation(b.code);
  if (!v.ok) {
    const msg =
      v.reason === "expired"      ? "Este link ya caducó. Pide uno nuevo a la academia." :
      v.reason === "already_used" ? "Este link ya se usó." :
      v.reason === "revoked"      ? "Este link fue invalidado por la academia." :
                                    "Link no válido.";
    return NextResponse.json({ ok: false, error: "invalid_invitation", message: msg }, { status: 400 });
  }

  // 2. Email único.
  const { data: existing } = await sb
    .from("users")
    .select("id")
    .eq("email", b.email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "email_in_use", message: "Ese email ya tiene cuenta en la academia." },
      { status: 409 },
    );
  }

  // 3. Crear user + teacher (inactive=true, registered_self=true).
  //    El temp password se descarta — se generará otro al aprobar.
  let created;
  try {
    created = await createUser({
      email:    b.email,
      fullName: b.name,
      phone:    whatsapp,
      language: "es",          // por defecto ES; admin puede cambiar
      role:     "teacher",
      inactive: true,
      teacherProfile: {
        bio:               null,
        languagesSpoken:   b.languages.split(",").map(s => s.trim()).filter(Boolean),
        specialties:       b.specialties.split(",").map(s => s.trim()).filter(Boolean),
        hourlyRate:        b.rate_individual,    // mantiene compat con campo viejo
        currency:          "EUR",
        paymentMethod:     null,
        notes:             null,
        address:           b.address,
        country:           b.country,
        levelsTaught:      b.levels,
        hourlyRateGroup:   b.rate_group,
        hourlyRateIndividual: b.rate_individual,
        iban:              b.iban,
        registeredSelf:    true,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // Si por carrera dos usuarios envían con el mismo email simultáneamente,
    // pegará en el unique constraint.
    if (/duplicate key|already exists/i.test(msg)) {
      return NextResponse.json(
        { ok: false, error: "email_in_use", message: "Ese email ya tiene cuenta." },
        { status: 409 },
      );
    }
    console.error("[teacher-register] createUser failed:", msg);
    return NextResponse.json(
      { ok: false, error: "create_failed", message: "No pudimos guardar tu solicitud. Inténtalo en unos minutos." },
      { status: 500 },
    );
  }

  // 4. Consumir invitación con race-guard. Si OTRO request lo consumió
  //    entre validateInvitation() y aquí, rollback del user creado.
  const consumed = await consumeInvitation(b.code, created.userId);
  if (!consumed.ok) {
    await sb.from("teachers").delete().eq("user_id", created.userId);
    await sb.from("users").delete().eq("id", created.userId);
    return NextResponse.json(
      { ok: false, error: "invitation_race", message: "Este link se acaba de usar en otro dispositivo." },
      { status: 409 },
    );
  }

  // 5. Notificar a todos los superadmins (in-app bell).
  try {
    const { data: superadmins } = await sb
      .from("users")
      .select("id")
      .eq("role", "superadmin")
      .eq("active", true);
    for (const u of (superadmins ?? []) as Array<{ id: string }>) {
      await createNotification({
        user_id: u.id,
        type:    "teacher_pending_approval",
        title:   "Nuevo profesor pendiente de aprobación",
        body:    `${b.name} ha enviado su solicitud para unirse como profesor.`,
        link:    `/admin/profesores/${created.teacherId}`,
      });
    }
  } catch (e) {
    // No bloquea — el admin puede ver pending entrando a /admin/profesores.
    console.error("[teacher-register] notify superadmins failed:", e);
  }

  return NextResponse.json({
    ok: true,
    teacher_id: created.teacherId,
    user_id:    created.userId,
  });
}
