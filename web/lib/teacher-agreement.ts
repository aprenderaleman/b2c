import { supabaseAdmin } from "@/lib/supabase";
import { buildTeacherAgreementPdf, type AgreementVars } from "@/lib/teacher-agreement-pdf";

/**
 * Acuerdo de Colaboración — helpers compartidos (aprobación, firma admin,
 * descarga/reenvío). Storage: bucket `materials`.
 *   acuerdos/<teacher_id>.pdf          → sin firmar (generado)
 *   acuerdos/<teacher_id>-firmado.pdf  → firmado por la academia
 *   firmas/<admin_user_id>.png         → firma de Gelfis (se guarda una vez)
 */
const BUCKET = "materials";

export const agreementPath       = (teacherId: string) => `acuerdos/${teacherId}.pdf`;
export const signedAgreementPath = (teacherId: string) => `acuerdos/${teacherId}-firmado.pdf`;
export const adminSignaturePath  = (adminUserId: string) => `firmas/${adminUserId}.png`;

async function upload(path: string, body: Buffer, contentType: string): Promise<string> {
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
  return path;
}

async function download(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadTeacherAgreement(teacherId: string, pdf: Buffer): Promise<string> {
  return upload(agreementPath(teacherId), pdf, "application/pdf");
}

export async function uploadSignedTeacherAgreement(teacherId: string, pdf: Buffer): Promise<string> {
  return upload(signedAgreementPath(teacherId), pdf, "application/pdf");
}

export async function getSignedTeacherAgreement(teacherId: string): Promise<Buffer | null> {
  return download(signedAgreementPath(teacherId));
}

export async function saveAdminSignature(adminUserId: string, png: Buffer): Promise<string> {
  return upload(adminSignaturePath(adminUserId), png, "image/png");
}

export async function getAdminSignature(adminUserId: string): Promise<Buffer | null> {
  return download(adminSignaturePath(adminUserId));
}

/** Datos del profe tal y como van al PDF. `rateOverride` = tarifa que el admin fija al aprobar. */
export async function loadAgreementVars(
  teacherId: string,
  opts?: { rateOverride?: number | null; startDate?: Date },
): Promise<(AgreementVars & { email: string; language: "es" | "de"; userId: string }) | null> {
  const { data } = await supabaseAdmin().from("teachers")
    .select("id, user_id, hourly_rate_individual, country, address, approved_at, created_at, users!inner(email, full_name, phone, language_preference, rango)")
    .eq("id", teacherId).maybeSingle();
  if (!data) return null;
  const t = data as {
    id: string; user_id: string; hourly_rate_individual: number | string | null; country: string | null;
    address: string | null; approved_at: string | null; created_at: string; users: unknown;
  };
  const u = (Array.isArray(t.users) ? t.users[0] : t.users) as {
    email: string; full_name: string | null; phone: string | null; language_preference: "es" | "de" | null; rango: string | null;
  };
  const rawRate = opts?.rateOverride ?? t.hourly_rate_individual;
  const rateEur = rawRate != null && Number.isFinite(Number(rawRate)) && Number(rawRate) > 0 ? Number(rawRate) : null;
  return {
    userId:    t.user_id,
    name:      u.full_name ?? u.email,
    email:     u.email,
    phone:     u.phone ?? null,
    country:   t.country ?? null,
    address:   t.address ?? null,
    startDate: opts?.startDate ?? new Date(t.approved_at ?? t.created_at),
    rateEur,
    rango:     u.rango ?? null,
    language:  u.language_preference ?? "es",
  };
}

/** Firma el acuerdo con la firma del admin (PNG) y lo guarda como "-firmado.pdf". */
export async function signTeacherAgreement(args: {
  teacherId: string; adminUserId: string; signaturePng: Buffer; rateOverride?: number | null;
}): Promise<{ path: string; pdf: Buffer }> {
  const vars = await loadAgreementVars(args.teacherId, { rateOverride: args.rateOverride });
  if (!vars) throw new Error("teacher_not_found");
  const signedAt = new Date();
  const pdf = await buildTeacherAgreementPdf({ ...vars, adminSignature: { png: args.signaturePng, date: signedAt } });
  const path = await uploadSignedTeacherAgreement(args.teacherId, pdf);
  await supabaseAdmin().from("teachers").update({
    agreement_signed_at: signedAt.toISOString(), agreement_signed_path: path,
  }).eq("id", args.teacherId);
  return { path, pdf };
}
