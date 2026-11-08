import { NextResponse } from "next/server";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { GUIA_NIVELES, guiaDisponible, guiaNivelPara, type GuiaNivel } from "@/lib/guias/primeras-frases";
import { renderGuiaPrimerasFrases } from "@/lib/guias/primeras-frases-pdf";

export const dynamic = "force-dynamic";

/**
 * Guía «Tus primeras 30 frases en alemán» en PDF.
 * - Alumno (o admin viéndolo como alumno): la de su nivel, solo si se
 *   inscribió dentro de la ventana de la promoción.
 * - Admin sin suplantar: cualquier nivel con ?nivel=A1…C1, para revisarlas.
 */
export async function GET(req: Request) {
  const session = await requireRoleWithImpersonation(["student", "admin", "superadmin"], "student");

  let nivel: GuiaNivel;
  let nombre: string | null = null;

  if (session.user.role === "student") {
    const student = await getStudentByUserId(session.user.id);
    if (!student || !guiaDisponible(student.converted_at)) {
      return NextResponse.json({ error: "not_available" }, { status: 403 });
    }
    nivel  = guiaNivelPara(student.current_level);
    nombre = student.full_name;
  } else {
    const q = new URL(req.url).searchParams.get("nivel")?.toUpperCase() as GuiaNivel | undefined;
    nivel = q && GUIA_NIVELES.includes(q) ? q : "A1";
  }

  const pdf = await renderGuiaPrimerasFrases(nivel, nombre);
  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="Tus-primeras-30-frases-en-aleman-${nivel}.pdf"`,
      "Content-Length":      String(pdf.byteLength),
      "Cache-Control":       "private, no-store",
    },
  });
}
