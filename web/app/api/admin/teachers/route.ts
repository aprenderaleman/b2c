import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { sendWelcomeStaffEmail } from "@/lib/email/send";

const Body = z.object({
  email:      z.string().trim().toLowerCase().email(),
  fullName:   z.string().trim().min(2).max(120),
  phone:      z.string().trim().max(30).nullable().default(null),
  language:   z.enum(["es", "de"]).default("es"),

  bio:              z.string().trim().max(2000).nullable().default(null),
  languagesSpoken:  z.array(z.string().trim().min(1)).min(1).default(["de"]),
  specialties:      z.array(z.string().trim().min(1)).default([]),
  hourlyRate:       z.coerce.number().min(0).max(1000).nullable().default(null),
  currency:         z.enum(["EUR", "USD", "CHF"]).default("EUR"),
  paymentMethod:    z.string().trim().max(200).nullable().default(null),
  notes:            z.string().trim().max(2000).nullable().default(null),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  let created;
  try {
    created = await createUser({
      email:     body.email,
      fullName:  body.fullName,
      phone:     body.phone,
      language:  body.language,
      role:      "teacher",
      teacherProfile: {
        bio:              body.bio,
        languagesSpoken:  body.languagesSpoken,
        specialties:      body.specialties,
        hourlyRate:       body.hourlyRate,
        currency:         body.currency,
        paymentMethod:    body.paymentMethod,
        notes:            body.notes,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/duplicate key|already exists/i.test(msg)) {
      return NextResponse.json(
        { error: "email_already_in_use", message: "Ese correo ya pertenece a otro usuario." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_failed", message: msg }, { status: 500 });
  }

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const emailResult = await sendWelcomeStaffEmail(body.email, {
    name:          body.fullName.split(/\s+/)[0] || body.fullName,
    email:         body.email,
    tempPassword:  created.tempPassword,
    platformUrl,
    role:          "teacher",
    language:      body.language,
  });

  return NextResponse.json({
    ok:           true,
    teacherId:    created.teacherId,
    userId:       created.userId,
    emailSent:    emailResult.ok,
    tempPassword: emailResult.ok ? null : created.tempPassword,
  });
}
