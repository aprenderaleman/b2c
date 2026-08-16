/**
 * Integración del anti-limbo (check 9 de la spec) contra la BD real.
 * Solo corre si hay credenciales en el entorno (SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY); en CI sin env se salta sola.
 *
 * Seed: lead desechable asignado a un closer real, sin tareas ni
 * cadenas → ensureFuturePlay debe crear la auto-tarea +3d; segunda
 * llamada no duplica; cleanup completo al final.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasEnv = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!hasEnv)("ensureFuturePlay (anti-limbo, BD real)", () => {
  let sb: import("@supabase/supabase-js").SupabaseClient;
  let ensureFuturePlay: typeof import("./semaforo").ensureFuturePlay;
  let leadId: string;
  let closerId: string;

  beforeAll(async () => {
    ({ ensureFuturePlay } = await import("./semaforo"));
    const { supabaseAdmin } = await import("./supabase");
    sb = supabaseAdmin();

    const { data: closer } = await sb
      .from("users").select("id").eq("role", "closer").eq("active", true).limit(1).single();
    closerId = (closer as { id: string }).id;

    const { data: lead, error } = await sb
      .from("leads")
      .insert({
        name: "[E2E anti-limbo]",
        email: `e2e-antilimbo-${Date.now()}@test.local`,
        german_level: "A0",
        language: "es",
        status: "in_conversation",
        estado_cierre: "activo",
        closer_id: closerId,
        source: "e2e_test",
        gdpr_accepted: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    leadId = (lead as { id: string }).id;
  });

  afterAll(async () => {
    if (!leadId) return;
    await sb.from("tareas_closer").delete().eq("lead_id", leadId);
    // Borrar el lead cascada lead_timeline y lead_contacts (las cascadas
    // del sistema están permitidas por la migración 115).
    await sb.from("leads").delete().eq("id", leadId);
  });

  it("crea la auto-tarea +3d cuando el lead queda sin jugada", async () => {
    const first = await ensureFuturePlay(leadId);
    expect(first.created).toBe(true);

    const { data: tareas } = await sb
      .from("tareas_closer")
      .select("tipo, plantilla, fecha_programada")
      .eq("lead_id", leadId)
      .is("fecha_completada", null);
    expect(tareas).toHaveLength(1);
    expect(tareas![0].tipo).toBe("auto_seguimiento");

    // ~3 días en el futuro (check 9: auto-tarea +3d visible)
    const diffMs = new Date(tareas![0].fecha_programada).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(2 * 24 * 3_600_000);
    expect(diffMs).toBeLessThan(4 * 24 * 3_600_000);
  });

  it("no duplica si ya hay jugada futura", async () => {
    const second = await ensureFuturePlay(leadId);
    expect(second.created).toBe(false);
  });
});
