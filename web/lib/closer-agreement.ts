import { supabaseAdmin } from "@/lib/supabase";
import { buildCloserAgreementPdf, type CloserAgreementVars } from "@/lib/closer-agreement-pdf";
import { getAdminSignature } from "@/lib/teacher-agreement";

/**
 * Acuerdo de Colaboración con Closers — helpers (Gelfis 2026-11-27).
 * Mismo esquema que el de profesores (lib/teacher-agreement.ts); la firma
 * del admin se reutiliza de materials/firmas/<admin_user_id>.png.
 * Storage: bucket `materials`.
 *   acuerdos-closers/<user_id>.pdf          → sin firmar (generado)
 *   acuerdos-closers/<user_id>-firmado.pdf  → firmado por la academia
 */
const BUCKET = "materials";

export const closerAgreementPath       = (userId: string) => `acuerdos-closers/${userId}.pdf`;
export const signedCloserAgreementPath = (userId: string) => `acuerdos-closers/${userId}-firmado.pdf`;

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

export async function uploadCloserAgreement(userId: string, pdf: Buffer): Promise<string> {
  return upload(closerAgreementPath(userId), pdf, "application/pdf");
}

export async function uploadSignedCloserAgreement(userId: string, pdf: Buffer): Promise<string> {
  return upload(signedCloserAgreementPath(userId), pdf, "application/pdf");
}

export async function getSignedCloserAgreement(userId: string): Promise<Buffer | null> {
  return download(signedCloserAgreementPath(userId));
}

/** Datos del closer tal y como van al PDF. */
export async function loadCloserAgreementVars(
  userId: string,
  opts?: { startDate?: Date },
): Promise<(CloserAgreementVars & { email: string; language: "es" | "de" }) | null> {
  const { data } = await supabaseAdmin().from("users")
    .select("id, email, full_name, phone, language_preference, rango, created_at, role")
    .eq("id", userId).eq("role", "closer").maybeSingle();
  if (!data) return null;
  const u = data as {
    id: string; email: string; full_name: string | null; phone: string | null;
    language_preference: "es" | "de" | null; rango: string | null; created_at: string;
  };
  return {
    name:      u.full_name ?? u.email,
    email:     u.email,
    phone:     u.phone ?? null,
    country:   null,
    address:   null,
    startDate: opts?.startDate ?? new Date(u.created_at),
    rango:     u.rango ?? null,
    language:  u.language_preference ?? "es",
  };
}

/** Firma el acuerdo con la firma del admin (PNG) y lo guarda como "-firmado.pdf". */
export async function signCloserAgreement(args: {
  closerUserId: string; adminUserId: string; signaturePng: Buffer;
}): Promise<{ path: string; pdf: Buffer }> {
  const vars = await loadCloserAgreementVars(args.closerUserId);
  if (!vars) throw new Error("closer_not_found");
  const signedAt = new Date();
  const pdf = await buildCloserAgreementPdf({ ...vars, adminSignature: { png: args.signaturePng, date: signedAt } });
  const path = await uploadSignedCloserAgreement(args.closerUserId, pdf);
  await supabaseAdmin().from("users").update({
    closer_agreement_signed_at: signedAt.toISOString(), closer_agreement_signed_path: path,
  }).eq("id", args.closerUserId);
  return { path, pdf };
}

/**
 * PDF listo para el alta: firmado con la firma guardada del admin si
 * existe (flujo normal — Gelfis ya la tiene de los acuerdos de profes);
 * sin firmar si no hay firma guardada.
 */
export async function buildAgreementForNewCloser(args: {
  closerUserId: string; adminUserId: string;
}): Promise<{ pdf: Buffer; path: string; signed: boolean } | null> {
  const vars = await loadCloserAgreementVars(args.closerUserId, { startDate: new Date() });
  if (!vars) return null;
  const png = await getAdminSignature(args.adminUserId);
  if (png) {
    const signedAt = new Date();
    const pdf = await buildCloserAgreementPdf({ ...vars, adminSignature: { png, date: signedAt } });
    const path = await uploadSignedCloserAgreement(args.closerUserId, pdf);
    await supabaseAdmin().from("users").update({
      closer_agreement_signed_at: signedAt.toISOString(), closer_agreement_signed_path: path,
    }).eq("id", args.closerUserId);
    return { pdf, path, signed: true };
  }
  const pdf = await buildCloserAgreementPdf(vars);
  const path = await uploadCloserAgreement(args.closerUserId, pdf);
  return { pdf, path, signed: false };
}
