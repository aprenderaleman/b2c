import { supabaseAdmin } from "@/lib/supabase";

/** Guarda el PDF del acuerdo en Storage (bucket materials) y devuelve la ruta. */
export async function uploadTeacherAgreement(teacherId: string, pdf: Buffer): Promise<string> {
  const sb = supabaseAdmin();
  const path = `acuerdos/${teacherId}.pdf`;
  const { error } = await sb.storage.from("materials").upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
  return path;
}
