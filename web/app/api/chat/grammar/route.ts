import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/chat/grammar { text }
 * Corrector gramatical español/alemán para el chat (Gelfis 2026-10-13).
 * Proxy a LanguageTool (detección automática de idioma, variantes es-ES y
 * de-DE). Devuelve las sugerencias con posición y reemplazo propuesto.
 * Si LANGUAGETOOL_URL no está definida se usa el servicio público, que
 * limita a ~20 peticiones/min por IP y 20 KB por texto.
 */
export const dynamic = "force-dynamic";

const LT_URL = (process.env.LANGUAGETOOL_URL ?? "https://api.languagetool.org/v2/check").replace(/\/$/, "");

export type GrammarMatch = {
  offset: number; length: number; message: string; short: string;
  replacement: string | null; rule: string; category: string;
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { text?: string; language?: string };
  const text = (body.text ?? "").slice(0, 20_000);
  if (text.trim().length < 3) return NextResponse.json({ language: null, matches: [] });

  const params = new URLSearchParams({
    text,
    language: body.language ?? "auto",
    preferredVariants: "es-ES,de-DE",
    enabledOnly: "false",
    level: "default",
  });
  try {
    const res = await fetch(LT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: params.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ language: null, matches: [], error: `lt_${res.status}` }, { status: 200 });
    const data = await res.json() as {
      language?: { code?: string; name?: string; detectedLanguage?: { code?: string } };
      matches?: Array<{ offset: number; length: number; message: string; shortMessage?: string; replacements?: Array<{ value: string }>; rule?: { id?: string; category?: { id?: string } } }>;
    };
    const matches: GrammarMatch[] = (data.matches ?? [])
      .filter(m => m.rule?.category?.id !== "TYPOGRAPHY" || /espacio|space/i.test(m.message))
      .slice(0, 40)
      .map(m => ({
        offset: m.offset, length: m.length, message: m.message, short: m.shortMessage ?? "",
        replacement: m.replacements?.[0]?.value ?? null,
        rule: m.rule?.id ?? "", category: m.rule?.category?.id ?? "",
      }));
    return NextResponse.json({ language: data.language?.detectedLanguage?.code ?? data.language?.code ?? null, matches });
  } catch (e) {
    return NextResponse.json({ language: null, matches: [], error: e instanceof Error ? e.message : "fetch_failed" }, { status: 200 });
  }
}
