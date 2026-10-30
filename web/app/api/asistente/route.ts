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
 * Copiloto de chat. Bucle de tool use con el SDK de Anthropic. Las
 * herramientas son de solo lectura; las acciones de escritura se devuelven
 * como `acciones` (propuestas) y las ejecuta el navegador contra los
 * endpoints cuando el usuario pulsa Confirmar — ver lib/asistente/tools.ts.
 *
 * Responde en streaming, una línea JSON por evento:
 *   {type:"text",delta} {type:"reset"} {type:"tool"} {type:"done",reply,acciones} {type:"error",message}
 * (`reset`: el texto parcial era de un paso intermedio, se descarta.)
 *
 * El historial lo reenvía el cliente (solo texto). La identidad es la de la
 * sesión real; la impersonación se ignora. Cada turno queda en asistente_logs.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const MAX_ITERATIONS = 8;
/** Con el tutor el uso sube: tope diario además del horario (coste). */
const MAX_DIARIO_ESTUDIANTE = 80;

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
  const sb = supabaseAdmin();
  const { data: u } = await sb.from("users").select("language_preference").eq("id", userId).maybeSingle();
  const lang = (u as { language_preference?: string } | null)?.language_preference === "de" ? "de" as const : "es" as const;

  if (role === "student") {
    const { data } = await sb.from("students").select("id, current_level, goal").eq("user_id", userId).maybeSingle();
    if (!data) return NextResponse.json({ error: "no_student_profile" }, { status: 403 });
    const s = data as { id: string; current_level: string | null; goal: string | null };
    return { role: "student", userId, name, lang, studentId: s.id, nivel: s.current_level, meta: s.goal };
  }
  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    return { role: "teacher", userId, name, lang, teacherId: me.id };
  }
  if (role === "admin" || role === "superadmin") return { role: "admin", userId, name, lang };
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
  const rlDia = ctx.role === "student"
    ? await checkRateLimit({ scope: "asistente_dia", key: ctx.userId, max: MAX_DIARIO_ESTUDIANTE, windowMs: 24 * 3600_000 })
    : { ok: true as const };
  if (!rl.ok || !rlDia.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Has hecho muchas consultas seguidas. Prueba de nuevo más tarde." },
      { status: 429 },
    );
  }

  const client = new Anthropic();
  const tools = toolsFor(ctx);
  const system = buildSystem(ctx);
  const messages: Anthropic.MessageParam[] = parsed.data.messages.map(m => ({ role: m.role, content: m.content }));
  const pregunta = parsed.data.messages[parsed.data.messages.length - 1].content;
  const acciones: AccionPropuesta[] = [];
  const usadas: string[] = [];
  const meta: { sinResolver: string | null } = { sinResolver: null };
  let inTok = 0, outTok = 0, cacheTok = 0;

  const log = (respuesta: string) => supabaseAdmin().from("asistente_logs").insert({
    user_id: ctx.userId, role: ctx.role, pregunta, respuesta,
    herramientas: usadas, acciones: acciones.map(a => ({ titulo: a.titulo, tipo: a.tipo })),
    sin_resolver: meta.sinResolver, input_tokens: inTok, output_tokens: outTok, cache_tokens: cacheTok,
  }).then(({ error }) => { if (error) console.warn("[asistente] log failed:", error.message); });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      const finish = async (reply: string) => {
        await log(reply);
        emit({ type: "done", reply, acciones });
        controller.close();
      };
      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const stream = client.messages.stream({
            model:         MODEL,
            max_tokens:    4096,
            output_config: { effort: "low" },
            system,
            tools:         tools.map(t => t.spec),
            messages,
          });
          stream.on("text", delta => emit({ type: "text", delta }));
          const res = await stream.finalMessage();
          inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
          cacheTok += res.usage.cache_read_input_tokens ?? 0;

          if (res.stop_reason === "refusal") {
            emit({ type: "reset" });
            await finish("No puedo ayudarte con eso. ¿Te ayudo con otra cosa?");
            return;
          }

          const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
            const reply = res.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map(b => b.text).join("\n").trim();
            console.log(`[asistente] role=${ctx.role} iter=${i + 1} in=${inTok} cache=${cacheTok} out=${outTok} acciones=${acciones.length}`);
            await finish(reply || (acciones.length > 0 ? "Te lo he preparado: revisa la tarjeta y confirma." : "No he podido completar la respuesta. ¿Puedes reformular?"));
            return;
          }

          emit({ type: "reset" });
          emit({ type: "tool" });
          messages.push({ role: "assistant", content: res.content });
          const results = await Promise.all(toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
            usadas.push(tu.name);
            if (tu.name === "registrar_no_resuelto") {
              meta.sinResolver = String((tu.input as { motivo?: unknown }).motivo ?? "").slice(0, 500) || "sin motivo";
              return { type: "tool_result", tool_use_id: tu.id, content: "Registrado." };
            }
            const r = await runTool(tools, tu.name, tu.input, acciones);
            return { type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError };
          }));
          messages.push({ role: "user", content: results });
        }
        console.warn(`[asistente] role=${ctx.role} hit MAX_ITERATIONS`);
        await finish("Me he liado con esta consulta. ¿Puedes pedírmelo de forma más concreta?");
      } catch (e) {
        let message = "Algo falló. Inténtalo de nuevo.";
        if (e instanceof Anthropic.RateLimitError) message = "El asistente está saturado ahora mismo. Inténtalo en un minuto.";
        else if (e instanceof Anthropic.APIError) {
          console.error(`[asistente] API error ${e.status}:`, e.message);
          message = "El asistente no está disponible en este momento.";
        } else console.error("[asistente] failed:", e);
        emit({ type: "error", message });
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
