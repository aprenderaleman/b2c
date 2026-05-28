import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createConversionSheet, serviceAccountEmail } from "@/lib/google-sheets";

/**
 * GET /api/admin/ads/setup-sheet
 *
 * Setup one-shot: crea la Google Sheet de conversiones offline, le pone
 * las cabeceras que Google Ads espera, y la comparte con
 * aprenderaleman2026@gmail.com para que aparezca en su Drive y pueda
 * seleccionarla en Google Ads.
 *
 * Devuelve el ID + URL de la hoja. Gelfis luego:
 *   1. Pone GADS_CONVERSIONS_SHEET_ID=<id> en Vercel.
 *   2. Selecciona la hoja en Google Ads (Importar → Google Sheets).
 *
 * Admin/superadmin gated. Pensado para abrirse desde el navegador
 * logueado en /admin.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cuenta de Google logueada en Google Ads (dueña del Drive donde debe
// aparecer la hoja). Se puede sobreescribir con ?email=otra@gmail.com.
const DEFAULT_SHARE_WITH = "helphis0405@gmail.com";

export async function GET(req: Request) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const emailParam = new URL(req.url).searchParams.get("email")?.trim();
  const SHARE_WITH = emailParam && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailParam)
    ? emailParam
    : DEFAULT_SHARE_WITH;

  const saEmail = serviceAccountEmail();
  if (!saEmail) {
    return NextResponse.json({
      ok: false,
      error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado en Vercel.",
    }, { status: 500 });
  }

  // Modo "solo info": devuelve el email del service account SIN crear
  // ninguna hoja. Para el flujo donde Gelfis crea la hoja él mismo
  // (Opción B) y necesita saber con qué cuenta compartirla.
  if (new URL(req.url).searchParams.get("info") === "1") {
    return NextResponse.json({
      ok: true,
      serviceAccountEmail: saEmail,
      instructions: `Comparte tu Google Sheet (Editor) con: ${saEmail}. Luego pon GADS_CONVERSIONS_SHEET_ID en Vercel y selecciónala en Google Ads.`,
    });
  }

  const result = await createConversionSheet(SHARE_WITH);
  if (!result) {
    return NextResponse.json({
      ok: false,
      error: "No se pudo crear la hoja. Revisa que el service account tenga las APIs Sheets + Drive habilitadas en Google Cloud.",
      serviceAccountEmail: saEmail,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sheetId:  result.id,
    sheetUrl: result.url,
    sharedWith: SHARE_WITH,
    serviceAccountEmail: saEmail,
    nextSteps: [
      `1. Copia este ID y ponlo en Vercel como GADS_CONVERSIONS_SHEET_ID: ${result.id}`,
      `2. Redeploy en Vercel para que el cron tome la env.`,
      `3. En Google Ads: Importar → Google Sheets → selecciona "Conversiones Google Ads — Aprender-Aleman.de" (está en tu Drive compartido).`,
      `4. Nombra la acción de conversión EXACTAMENTE: "Cliente convertido (offline)" (o ajusta GADS_CONVERSION_NAME).`,
    ],
  });
}
