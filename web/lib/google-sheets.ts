/**
 * Google Sheets helper — reutiliza el Service Account de Google Calendar
 * (GOOGLE_SERVICE_ACCOUNT_JSON) para escribir conversiones offline en
 * una hoja conectada a Google Ads.
 *
 * Setup necesario (una sola vez, lo hace Gelfis):
 *   1. Crear una Google Sheet.
 *   2. Compartirla (Editor) con el email del service account
 *      (campo client_email del GOOGLE_SERVICE_ACCOUNT_JSON).
 *   3. Poner el ID de la hoja en env GADS_CONVERSIONS_SHEET_ID
 *      (el ID es la parte de la URL entre /d/ y /edit).
 *
 * env-gate: si falta GOOGLE_SERVICE_ACCOUNT_JSON o
 * GADS_CONVERSIONS_SHEET_ID, las funciones devuelven false sin lanzar.
 */
import type { sheets_v4 } from "@googleapis/sheets";

export function sheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GADS_CONVERSIONS_SHEET_ID);
}

async function getSheetsClient(): Promise<sheets_v4.Sheets | null> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error("[gsheets] GOOGLE_SERVICE_ACCOUNT_JSON not valid JSON");
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) {
    console.error("[gsheets] SA JSON missing client_email or private_key");
    return null;
  }

  const { JWT } = await import("google-auth-library");
  const { sheets } = await import("@googleapis/sheets");
  const privateKey = parsed.private_key.replace(/\\n/g, "\n");
  const auth = new JWT({
    email:  parsed.client_email,
    key:    privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return sheets({ version: "v4", auth });
}

/**
 * Asegura que la hoja tenga las cabeceras que Google Ads espera para
 * importación de conversiones offline (formato GCLID). Idempotente:
 * sólo escribe la cabecera si la fila 1 está vacía.
 *
 * Formato oficial Google Ads (Conversiones → Importar → Google Sheets):
 *   Parameters:TimeZone=...
 *   Google Click ID | Conversion Name | Conversion Time | Conversion Value | Conversion Currency
 */
const HEADER_ROW = [
  "Google Click ID",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
];

export async function ensureConversionHeader(): Promise<boolean> {
  const client = await getSheetsClient();
  const sheetId = process.env.GADS_CONVERSIONS_SHEET_ID;
  if (!client || !sheetId) return false;

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "A1:E2",
    });
    const rows = res.data.values ?? [];
    // Google Ads exige una primera fila "Parameters:TimeZone=..." y luego
    // la cabecera. Si A1 no empieza por "Parameters:", reescribimos las
    // dos primeras filas.
    const a1 = (rows[0]?.[0] ?? "").toString();
    if (!a1.startsWith("Parameters:")) {
      await client.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: "A1:E2",
        valueInputOption: "RAW",
        requestBody: {
          values: [
            ["Parameters:TimeZone=Europe/Berlin", "", "", "", ""],
            HEADER_ROW,
          ],
        },
      });
    }
    return true;
  } catch (e) {
    console.error("[gsheets] ensureConversionHeader failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export type ConversionRow = {
  gclid:        string;
  conversionName: string;
  // Formato Google Ads: "yyyy-MM-dd HH:mm:ss+|-HH:mm" o ISO. Usamos
  // ISO-like con offset de Berlín.
  conversionTime: string;
  value:        number;
  currency:     string;
};

/**
 * Añade filas de conversión al final de la hoja (append). Devuelve el
 * número de filas escritas, o -1 si falló / no configurado.
 */
export async function appendConversions(rows: ConversionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await getSheetsClient();
  const sheetId = process.env.GADS_CONVERSIONS_SHEET_ID;
  if (!client || !sheetId) return -1;

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A:E",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: rows.map(r => [
          r.gclid, r.conversionName, r.conversionTime, String(r.value), r.currency,
        ]),
      },
    });
    return rows.length;
  } catch (e) {
    console.error("[gsheets] appendConversions failed:", e instanceof Error ? e.message : e);
    return -1;
  }
}
