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

/**
 * Escribe las cabeceras (fila 1) en la hoja indicada. Formato Data
 * Manager de Google Ads: las columnas van directamente en A1:E1, SIN
 * la línea "Parameters:TimeZone=" del método clásico (la zona horaria
 * se configura en el mapeo de campos del UI de Google Ads).
 *
 * Idempotente: sólo escribe si A1 no es ya "Google Click ID".
 */
export async function writeHeaderToSheet(sheetId: string): Promise<boolean> {
  const client = await getSheetsClient();
  if (!client) return false;
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "A1:E1",
    });
    const a1 = (res.data.values?.[0]?.[0] ?? "").toString();
    if (a1 !== HEADER_ROW[0]) {
      await client.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: "A1:E1",
        valueInputOption: "RAW",
        requestBody: { values: [HEADER_ROW] },
      });
    }
    return true;
  } catch (e) {
    console.error("[gsheets] writeHeaderToSheet failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function ensureConversionHeader(): Promise<boolean> {
  const sheetId = process.env.GADS_CONVERSIONS_SHEET_ID;
  if (!sheetId) return false;
  return writeHeaderToSheet(sheetId);
}

/**
 * Crea una hoja nueva para conversiones de Google Ads, le pone las
 * cabeceras OCI, y la comparte (Editor) con el email indicado para que
 * aparezca en su Drive y Google Ads pueda seleccionarla.
 *
 * Devuelve { id, url } o null si falla / no hay service account.
 * La hoja queda propiedad del service account (nuestro cron escribe
 * sin sharing extra) y compartida con el usuario (Google Ads la lee).
 */
export async function createConversionSheet(shareWithEmail: string): Promise<{ id: string; url: string } | null> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  let parsed: { client_email?: string; private_key?: string };
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed.client_email || !parsed.private_key) return null;

  const { JWT } = await import("google-auth-library");
  const { sheets } = await import("@googleapis/sheets");
  const { drive }  = await import("@googleapis/drive");
  const privateKey = parsed.private_key.replace(/\\n/g, "\n");
  const auth = new JWT({
    email:  parsed.client_email,
    key:    privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const sheetsApi = sheets({ version: "v4", auth });
  const driveApi  = drive({ version: "v3", auth });

  try {
    // 1. Crear la hoja con las cabeceras en la fila 1 (formato Data
    //    Manager — sin línea "Parameters:", la zona horaria se mapea
    //    en el UI de Google Ads).
    const created = await sheetsApi.spreadsheets.create({
      requestBody: {
        properties: { title: `Conversiones Google Ads — Aprender-Aleman.de` },
        sheets: [{
          properties: { title: "Conversions" },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [
              { values: HEADER_ROW.map(h => ({ userEnteredValue: { stringValue: h } })) },
            ],
          }],
        }],
      },
    });
    const id = created.data.spreadsheetId;
    if (!id) return null;

    // 2. Compartir con el email del usuario (Editor) para que aparezca
    //    en su Drive y Google Ads pueda seleccionarla.
    await driveApi.permissions.create({
      fileId: id,
      sendNotificationEmail: true,
      requestBody: { type: "user", role: "writer", emailAddress: shareWithEmail },
    });

    return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
  } catch (e) {
    console.error("[gsheets] createConversionSheet failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Email del service account (para instrucciones de compartir). */
export function serviceAccountEmail(): string | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try { return (JSON.parse(json) as { client_email?: string }).client_email ?? null; }
  catch { return null; }
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
