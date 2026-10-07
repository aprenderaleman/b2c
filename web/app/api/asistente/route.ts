import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSystem } from "@/lib/asistente/prompt";
import { toolsFor, runTool, type AsistenteCtx, type AccionPropuesta } from "@/lib/asistente/tools";

/**
 * POST /api/asistente  { messages: [{ role, content }] }
 *
 * Copiloto de chat (MVP — Gelfis 2026-10-07). Bucle de tool use con el
 * SDK de Anthropic. Las herramientas son de solo lectura; las acciones
 * de escritura se devuelven como `acciones` (propuestas) y las ejecuta
 * el navegador contra los endpoints existentes cuando el usuario pulsa
 * Confirmar — ver lib/asistente/tools.ts.
 *
 * Sin estado en servidor: el cliente reenvía el historial (solo texto).
 * La identidad es la de la sesión real; la impersonación se ignora.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-5-5";
const MAX_ITERATIONS = 8;

const Body = z.object({
  messages: z.array(z.object({
    role:    z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(6000),
  })).min(1).max(40),
});

async function resolveCtx(): Promise<AsistenteCtx | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role   = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;
  const name   = session.user.name ?? session.user.email ?? "Usuario";

  if (role === "student") {
    const sb = supabaseAdmin();
    const { data } = await sb.from("students").select("id").eq("user_id", userId).maybeSingle();
    if (!data) return NextResponse.json({ error: "no_student_profile" }, { status: 403 });
    return { role: "student", userId, name, studentId: (data as { id: string }).id };
  }
  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    return { role: "teacher", userId, name, teacherId: me.id };
  }
  if (role === "admin" || role === "superadmin") return { role: "admin", userId, name };
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req: Request) {
  const ctx = await resolveCtx();
  if (ctx instanceof NextResponse) return ctx;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "not_configured", message: "El asistente no está disponible en este momento." }, { status: 503 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const rl = await checkRateLimit({ scope: "asistente", key: ctx.userId, max: 60, windowMs: 60 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Has hecho muchas consultas seguidas. Prueba de nuevo en unos minutos." },
      { status: 429 },
    );
  }

  const client = new Anthropic();
  const tools = toolsFor(ctx);
  const system = buildSystem(ctx);
  const messages: Anthropic.MessageParam[] = parsed.data.messages.map(m => ({ role: m.role, content: m.content }));
  const acciones: AccionPropuesta[] = [];
  let inTok = 0, outTok = 0, cacheTok = 0;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await client.messages.create({
        model:         MODEL,
        max_tokens:    4096,
        output_config: { effort: "low" },
        system,
        tools:         tools.map(t => t.spec),
        messages,
      });
      inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
      cacheTok += res.usage.cache_read_input_tokens ?? 0;

      if (res.stop_reason === "refusal") {
        return NextResponse.json({ reply: "No puedo ayudarte con eso. ¿Te ayudo con tus clases?", acciones: [] });
      }

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text).join("\n").trim();
        console.log(`[asistente] role=${ctx.role} iter=${i + 1} in=${inTok} cache=${cacheTok} out=${outTok} acciones=${acciones.length}`);
        return NextResponse.json({
          reply: reply || (acciones.length > 0 ? "Te lo he preparado: revisa la tarjeta y confirma." : "No he podido completar la respuesta. ¿Puedes reformular?"),
          acciones,
        });
      }

      messages.push({ role: "assistant", content: res.content });
      const results = await Promise.all(toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
        const r = await runTool(tools, tu.name, tu.input, acciones);
        return { type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError };
      }));
      messages.push({ role: "user", content: results });
    }
    console.warn(`[asistente] role=${ctx.role} hit MAX_ITERATIONS`);
    return NextResponse.json({
      reply: "Me he liado con esta consulta. ¿Puedes pedírmelo de forma más concreta?",
      acciones,
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "busy", message: "El asistente está saturado ahora mismo. Inténtalo en un minuto." }, { status: 503 });
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`[asistente] API error ${e.status}:`, e.message);
      return NextResponse.json({ error: "upstream", message: "El asistente no está disponible en este momento." }, { status: 502 });
    }
    console.error("[asistente] failed:", e);
    return NextResponse.json({ error: "failed", message: "Algo falló. Inténtalo de nuevo." }, { status: 500 });
  }
}
