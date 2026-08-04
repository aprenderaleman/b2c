import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { createUser } from "@/lib/users";
import { sanitizeE164 } from "@/lib/phone";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import { sendRaw } from "@/lib/email/send";
import {
  validateInvitation,
  consumeInvitation,
} from "@/lib/teacher-invitations";

/**
 * POST /api/public/teacher-register
 *
 * Endpoint público del registro de profesores por invitación
 * (rediseño 2026-08-02). Las CONDICIONES (email, tarifa individual,
 * rango, accepts_trials) vienen de la invitación creada por el admin
 * — el candidato no puede alterarlas: cualquier valor que mande el
 * cliente para esos campos se ignora.
 *
 * Body:
 *   {
 *     code:            "<invitation_code>",
 *     name:            "Sabine Arning",
 *     whatsapp_e164:   "+49152...",
 *     whatsapp_raw:    "+49 152 ...",
 *     address:         "...",
 *     country:         "DE",
 *     languages:       "Alemán nativo, Español B2",
 *     specialties:     "Gramática A1-A2, conversación B1",
 *     levels:          ["A1","A2","B1"],
 *     iban:            "ES00...",
 *     gdpr_accepted:   true
 *   }
 *
 * Comportamiento:
 *   1. Rate-limit por IP (5/h).
 *   2. Validar Zod.
 *   3. Validar invitation code → condiciones + email de la invitación.
 *   4. Verificar email único en `users`.
 *   5. createUser inactive con la tarifa de la invitación.
 *   6. Aplicar rango (users.rango) y accepts_trials (teachers).
 *   7. consumeInvitation(code, userId) con race-guard.
 *   8. Notificación in-app + email a superadmins.
 *   9. NO se manda welcome al profe — eso espera a que admin apruebe.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const Body = z.object({
  code:             z.string().trim().min(8).max(64),
  name:             z.string().trim().min(2).max(120),
  whatsapp_e164:    z.string().trim().regex(/^\+?[0-9]{8,15}$/),
  whatsapp_raw:     z.string().trim().max(40).optional(),
  address:          z.string().trim().min(4).max(300),
  country:          z.string().trim().length(2).toUpperCase(),
  languages:        z.string().trim().min(2).max(500),
  specialties:      z.string().trim().min(2).max(500),
  levels:           z.array(z.enum(["A0","A1","A2","B1","B2","C1","C2"])).min(1),
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
  const inv = v.invitation;

  // El email SIEMPRE es el de la invitación — el form lo muestra
  // bloqueado y el server lo impone aunque manipulen el request.
  const email = (inv.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "invitation_without_email", message: "Esta invitación no tiene email asociado. Contacta con la academia." },
      { status: 400 },
    );
  }
  const rateIndividual = inv.rate_individual_eur;

  // 2. Email único.
  const { data: existing } = await sb
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "email_in_use", message: "Ese email ya tiene cuenta en la academia." },
      { status: 409 },
    );
  }

  // 3. Crear user + teacher (inactive=true, registered_self=true) con
  //    la TARIFA DE LA INVITACIÓN (no hay tarifa editable en el form).
  let created;
  try {
    created = await createUser({
      email,
      fullName: b.name,
      phone:    whatsapp,
      language: "es",
      role:     "teacher",
      inactive: true,
      teacherProfile: {
        bio:               null,
        languagesSpoken:   b.languages.split(",").map(s => s.trim()).filter(Boolean),
        specialties:       b.specialties.split(",").map(s => s.trim()).filter(Boolean),
        hourlyRate:        rateIndividual,
        currency:          "EUR",
        paymentMethod:     null,
        notes:             null,
        address:           b.address,
        country:           b.country,
        levelsTaught:      b.levels,
        hourlyRateGroup:   0,             // no existen clases grupales; la columna es NOT NULL
        hourlyRateIndividual: rateIndividual,
        iban:              b.iban,
        registeredSelf:    true,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
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

  // 4. Aplicar condiciones de la invitación.
  //    - rango → users.rango (el motor de comisiones lee de ahí)
  //    - accepts_trials → teachers
  try {
    await sb.from("users")
      .update({ rango: inv.rango })
      .eq("id", created.userId);
    await sb.from("teachers")
      .update({ accepts_trials: inv.accepts_trials })
      .eq("id", created.teacherId);
  } catch (e) {
    console.error("[teacher-register] apply invitation conditions failed:", e);
  }

  // 5. Consumir invitación con race-guard. Si OTRO request lo consumió
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

  // 7. Notificar a superadmins: in-app bell + email.
  try {
    const { data: superadmins } = await sb
      .from("users")
      .select("id, email")
      .eq("role", "superadmin")
      .eq("active", true);
    for (const u of (superadmins ?? []) as Array<{ id: string; email: string | null }>) {
      await createNotification({
        user_id: u.id,
        type:    "teacher_pending_approval",
        title:   "Nuevo profesor pendiente de aprobación",
        body:    `${b.name} ha completado su registro de profesor.`,
        link:    `/admin/profesores/${created.teacherId}`,
      });
      if (u.email) {
        const base = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
        const profileUrl = `${base}/admin/profesores/${created.teacherId}`;
        await sendRaw(
          u.email,
          `✅ Registro completado: ${b.name} (profesor)`,
          `<p><strong>${b.name}</strong> (${email}) completó su registro de profesor.</p>` +
          `<p>Condiciones de la invitación: ${rateIndividual ?? "?"}€/h · rango ${inv.rango}` +
          `${inv.accepts_trials ? " · recibe trials" : ""}.</p>` +
          `<p><a href="${profileUrl}">Revisar y aprobar →</a></p>`,
          `${b.name} (${email}) completó su registro de profesor. Aprobar: ${profileUrl}`,
        ).catch(() => {});
      }
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
