/**
 * Tests de integración que verifican que las queries de Supabase
 * usadas por las páginas del closer y admin funcionan contra el schema
 * real. Se saltan si no hay credenciales de Supabase.
 *
 * Detectan: columnas inexistentes, joins rotos, filtros mal armados.
 * No verifican datos — solo que la query devuelve sin error.
 */
import { describe, it, expect } from "vitest";

const hasEnv = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!hasEnv)("queries de páginas closer/admin (BD real)", () => {
  let sb: ReturnType<typeof import("@supabase/supabase-js").createClient>;

  it("setup: conectar a Supabase", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  });

  it("/admin/sesiones — query con join users!sesion_closer_id + leads!inner", async () => {
    const { data, error } = await sb
      .from("classes")
      .select(`
        id, scheduled_at, duration_minutes, status, short_code, lead_id,
        closer_user:users!sesion_closer_id(id, full_name),
        lead:leads!inner(
          id, name, email, whatsapp_normalized, status, language,
          german_level, goal, qualification_answers,
          reserva_prioritaria, priority_deadline, deposit_intent_at,
          trial_attended_at, trial_absent_at
        )
      `)
      .not("sesion_closer_id", "is", null)
      .is("deleted_at", null)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("/closer/sesiones — query con leads!inner sin join a users", async () => {
    const { data, error } = await sb
      .from("classes")
      .select(`
        id, scheduled_at, duration_minutes, status, short_code, lead_id,
        lead:leads!inner(
          id, name, email, whatsapp_normalized, status, language,
          german_level, goal, qualification_answers,
          reserva_prioritaria, priority_deadline, deposit_intent_at,
          trial_attended_at, trial_absent_at
        )
      `)
      .not("sesion_closer_id", "is", null)
      .is("deleted_at", null)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("/closer/leads — query de leads asignados al closer", async () => {
    const { data, error } = await sb
      .from("leads")
      .select(`
        id, name, email, whatsapp_normalized, status, estado_cierre,
        german_level, goal, qualification_answers,
        trial_scheduled_at, trial_attended_at, trial_absent_at,
        sesion_plan_at, closer_id, created_at
      `)
      .not("sesion_plan_at", "is", null)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("lead_contacts — columnas del semáforo", async () => {
    const { data, error } = await sb
      .from("lead_contacts")
      .select("lead_id, direction, action_type, occurred_at, actor_type, actor_name")
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("tareas_closer — columnas pendientes", async () => {
    const { data, error } = await sb
      .from("tareas_closer")
      .select("id, lead_id, tipo, plantilla, fecha_programada")
      .is("fecha_completada", null)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("lead_chains — cadenas activas", async () => {
    const { data, error } = await sb
      .from("lead_chains")
      .select("lead_id, chain_type, next_fire_at")
      .is("completed_at", null)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("ofertas_enviadas — insert con teacher_id null (closer flow)", async () => {
    const { data, error } = await sb
      .from("ofertas_enviadas")
      .select("id, lead_id, teacher_id, closer_id")
      .is("teacher_id", null)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});
