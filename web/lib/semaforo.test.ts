/**
 * Tests del semáforo global (fase 2) — función pura evaluateSemaforo
 * + reloj hábil. Cubre los checks de aceptación de la spec que no
 * requieren BD, incluido C5 (ventana nocturna).
 *
 * Fechas en agosto 2026 → Berlín está en CEST (UTC+2); usamos offsets
 * explícitos para que los tests no dependan de la TZ de la máquina.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateSemaforo,
  businessMsBetween,
  feedbackPendienteProfe,
  type SemaforoInput,
  type SemaforoLead,
} from "./semaforo";
import { registerContact } from "./contacts";

const ms = (iso: string) => new Date(iso).getTime();

const BASE_LEAD: SemaforoLead = {
  id: "lead-1",
  created_at: "2026-08-10T10:00:00+02:00",
  status: "in_conversation",
  estado_cierre: "activo",
  trial_scheduled_at: null,
  trial_attended_at: null,
  trial_absent_at: null,
  sesion_plan_at: null,
};

const saliente = (at: string, action = "mensaje_stiv") => ({
  lead_id: "lead-1", direction: "saliente" as const, action_type: action,
  occurred_at: new Date(at).toISOString(), actor_type: "stiv", actor_name: null,
});
const entrante = (at: string) => ({
  lead_id: "lead-1", direction: "entrante" as const, action_type: "mensaje_lead",
  occurred_at: new Date(at).toISOString(), actor_type: "lead", actor_name: null,
});
const tarea = (at: string, tipo = "tipo_a") => ({
  id: "t1", lead_id: "lead-1", tipo, plantilla: "plantilla test",
  fecha_programada: new Date(at).toISOString(),
});

function input(partial: Partial<SemaforoInput> & { now: number }): SemaforoInput {
  return {
    lead: BASE_LEAD, contacts: [], tareas: [], chain: null, ventaPendiente: null,
    epochMs: 0,   // los tests usan fechas fijas anteriores al epoch real
    ...partial,
  };
}

describe("businessMsBetween (ventana 08-22 Berlín)", () => {
  it("suma solo horas hábiles a través de la noche", () => {
    // 20:00 → 09:00 del día siguiente = 2h (20-22) + 1h (08-09) = 3h
    const from = ms("2026-08-12T20:00:00+02:00");
    const to   = ms("2026-08-13T09:00:00+02:00");
    expect(businessMsBetween(from, to)).toBe(3 * 3_600_000);
  });

  it("lo nocturno cuenta 0 hasta las 08:00", () => {
    const from = ms("2026-08-12T23:30:00+02:00");
    expect(businessMsBetween(from, ms("2026-08-13T07:59:00+02:00"))).toBe(0);
    expect(businessMsBetween(from, ms("2026-08-13T08:30:00+02:00"))).toBe(30 * 60_000);
  });
});

describe("C5 — reloj nocturno (R1)", () => {
  // Lead con un saliente previo (para aislar R1 de R4) que responde 23:30.
  const contacts = [
    saliente("2026-08-12T18:00:00+02:00"),
    entrante("2026-08-12T23:30:00+02:00"),
  ];

  it("a las 09:59 del día siguiente NO es rojo (1h59 hábiles)", () => {
    const r = evaluateSemaforo(input({ now: ms("2026-08-13T09:59:00+02:00"), contacts }));
    expect(r.color).not.toBe("rojo");
  });

  it("a las 10:01 del día siguiente ES rojo R1 (2h01 hábiles)", () => {
    const r = evaluateSemaforo(input({ now: ms("2026-08-13T10:01:00+02:00"), contacts }));
    expect(r.color).toBe("rojo");
    expect(r.regla).toBe("R1");
    expect(r.causa).toBe("respuesta");
  });
});

describe("R4 — lead nuevo sin primer toque", () => {
  const lead = { ...BASE_LEAD, created_at: "2026-08-12T23:00:00+02:00" };

  it("29min hábiles → aún no es rojo", () => {
    const r = evaluateSemaforo(input({ now: ms("2026-08-13T08:29:00+02:00"), lead }));
    expect(r.color).not.toBe("rojo");
  });

  it("31min hábiles → rojo R4 🆕", () => {
    const r = evaluateSemaforo(input({ now: ms("2026-08-13T08:31:00+02:00"), lead }));
    expect(r.color).toBe("rojo");
    expect(r.regla).toBe("R4");
    expect(r.badge).toContain("🆕");
  });

  it("un envío de Stiv apaga R4", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T08:31:00+02:00"), lead,
      contacts: [saliente("2026-08-13T08:05:00+02:00")],
    }));
    expect(r.regla).not.toBe("R4");
  });
});

describe("R2 / A1 / V1 — tareas por día Berlín", () => {
  const now = ms("2026-08-13T12:00:00+02:00");

  it("tarea de ayer → rojo R2 📅", () => {
    const r = evaluateSemaforo(input({
      now,
      contacts: [saliente("2026-08-13T09:00:00+02:00")],
      tareas: [tarea("2026-08-12T18:00:00+02:00")],
    }));
    expect(r.regla).toBe("R2");
    expect(r.badge).toContain("📅");
  });

  it("tarea de hoy → amarillo A1", () => {
    const r = evaluateSemaforo(input({
      now,
      contacts: [saliente("2026-08-13T09:00:00+02:00")],
      tareas: [tarea("2026-08-13T18:00:00+02:00")],
    }));
    expect(r.color).toBe("amarillo");
    expect(r.regla).toBe("A1");
  });

  it("tarea futura → verde V1", () => {
    const r = evaluateSemaforo(input({
      now,
      contacts: [saliente("2026-08-13T09:00:00+02:00")],
      tareas: [tarea("2026-08-15T10:00:00+02:00")],
    }));
    expect(r.color).toBe("verde");
    expect(r.regla).toBe("V1");
  });
});

describe("R3 / A3 — enlace de pago", () => {
  it("enlace hace 3h01 hábiles sin pago ni saliente posterior → rojo R3 💰", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T13:01:00+02:00"),
      contacts: [saliente("2026-08-13T10:00:00+02:00", "enviar_enlace")],
    }));
    expect(r.regla).toBe("R3");
    expect(r.causa).toBe("pago");
    expect(r.badge).toContain("💰");
  });

  it("enlace hace <3h → amarillo A3", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T11:00:00+02:00"),
      contacts: [saliente("2026-08-13T10:00:00+02:00", "enviar_enlace")],
    }));
    expect(r.color).toBe("amarillo");
    expect(r.regla).toBe("A3");
  });

  it("saliente posterior al enlace apaga R3", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T14:00:00+02:00"),
      contacts: [
        saliente("2026-08-13T10:00:00+02:00", "enviar_enlace"),
        saliente("2026-08-13T12:00:00+02:00"),
      ],
    }));
    expect(r.regla).not.toBe("R3");
  });

  it("pago registrado apaga R3 y A3", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T14:00:00+02:00"),
      contacts: [
        saliente("2026-08-13T10:00:00+02:00", "enviar_enlace"),
        { lead_id: "lead-1", direction: "entrante" as const, action_type: "confirmar_pago",
          occurred_at: new Date("2026-08-13T11:00:00+02:00").toISOString(), actor_type: "lead", actor_name: null },
      ],
    }));
    expect(r.regla).not.toBe("R3");
    expect(r.regla).not.toBe("A3");
  });
});

describe("R5 — post-clase sin propuesta", () => {
  const lead = { ...BASE_LEAD, trial_attended_at: "2026-08-13T09:00:00+02:00" };
  const now = ms("2026-08-13T12:00:00+02:00"); // 3h hábiles después

  it("asistió hace 3h sin propuesta ni tarea futura → rojo R5 🎓", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-12T10:00:00+02:00")],
    }));
    expect(r.regla).toBe("R5");
    expect(r.badge).toContain("🎓");
  });

  it("propuesta posterior apaga R5", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-13T10:00:00+02:00", "enviar_propuesta")],
    }));
    expect(r.regla).not.toBe("R5");
  });

  it("tarea futura apaga R5", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-12T10:00:00+02:00")],
      tareas: [tarea("2026-08-15T10:00:00+02:00")],
    }));
    expect(r.regla).not.toBe("R5");
  });

  it("cadena activa apaga R5 — su paso 1 ya mandó el enlace (caso Alicia)", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-12T10:00:00+02:00")],
      chain: { lead_id: "lead-1", chain_type: "sesion_attended", next_fire_at: "2026-08-18T09:36:00+02:00" },
    }));
    expect(r.regla).not.toBe("R5");
    expect(r.color).toBe("verde");
  });

  it("sin propuesta, sin tarea Y sin cadena → sigue siendo R5", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-12T10:00:00+02:00")],
      chain: null,
    }));
    expect(r.regla).toBe("R5");
  });
});

describe("Prioridad dentro del rojo: 💰 → 💬 → 🆕 → 🎓 → 📅", () => {
  it("enlace impago gana a respuesta sin atender", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T15:00:00+02:00"),
      contacts: [
        entrante("2026-08-13T09:00:00+02:00"),               // R1 (6h)
        saliente("2026-08-13T08:30:00+02:00", "enviar_enlace"), // R3 (6h30) — pero saliente NO posterior al inbound...
      ],
    }));
    // El inbound (09:00) es posterior al enlace (08:30) → R3 exige "sin
    // saliente posterior al envío": el inbound no es saliente, se cumple.
    // R1 exige "sin saliente posterior al inbound": se cumple.
    // Ambos rojos activos → gana 💰 pago.
    expect(r.color).toBe("rojo");
    expect(r.causa).toBe("pago");
  });
});

describe("V2 / V3 / FUERA / LIMBO", () => {
  const now = ms("2026-08-13T12:00:00+02:00");

  it("convertido → verde 💰 V2", () => {
    const r = evaluateSemaforo(input({
      now, lead: { ...BASE_LEAD, status: "converted", estado_cierre: "convertido" },
    }));
    expect(r.color).toBe("verde");
    expect(r.regla).toBe("V2");
    expect(r.badge).toContain("💰");
  });

  it("en_reactivacion → verde V3", () => {
    const r = evaluateSemaforo(input({
      now, lead: { ...BASE_LEAD, estado_cierre: "en_reactivacion" },
      contacts: [saliente("2026-08-13T11:00:00+02:00")],
    }));
    expect(r.regla).toBe("V3");
  });

  it("perdido → fuera (sin color)", () => {
    const r = evaluateSemaforo(input({
      now, lead: { ...BASE_LEAD, estado_cierre: "perdido" },
    }));
    expect(r.color).toBe("fuera");
  });

  it("cadena activa → verde V1", () => {
    const r = evaluateSemaforo(input({
      now,
      contacts: [saliente("2026-08-13T11:00:00+02:00")],
      chain: { lead_id: "lead-1", chain_type: "chain1_attended", next_fire_at: "2026-08-14T10:00:00+02:00" },
    }));
    expect(r.color).toBe("verde");
    expect(r.regla).toBe("V1");
  });

  it("lead activo sin jugada → LIMBO marcado (el anti-limbo lo sana)", () => {
    const r = evaluateSemaforo(input({
      now,
      contacts: [saliente("2026-08-13T11:00:00+02:00")],
    }));
    expect(r.regla).toBe("LIMBO");
    expect(r.limbo).toBe(true);
  });
});

describe("Check 5 — rojo 🎓 del profesor (feedback post-clase)", () => {
  // Clase 09:00-09:40; el reloj de 2h hábiles corre desde las 09:40.
  const base = {
    scheduledAt: "2026-08-13T09:00:00+02:00",
    durationMin: 40,
    attendedAt: null,
    absentAt: null,
    epochMs: 0,
  };

  it("a 1h59 hábiles del fin de clase → aún no", () => {
    expect(feedbackPendienteProfe({ ...base, now: ms("2026-08-13T11:39:00+02:00") })).toBeNull();
  });

  it("a 2h01 hábiles → rojo 🎓", () => {
    const r = feedbackPendienteProfe({ ...base, now: ms("2026-08-13T11:41:00+02:00") });
    expect(r).not.toBeNull();
    expect(r!.badge).toContain("🎓");
  });

  it("asistencia registrada lo apaga", () => {
    expect(feedbackPendienteProfe({
      ...base, attendedAt: "2026-08-13T10:00:00+02:00", now: ms("2026-08-13T15:00:00+02:00"),
    })).toBeNull();
  });

  it("clase anterior al epoch no genera rojo retroactivo", () => {
    expect(feedbackPendienteProfe({
      ...base,
      epochMs: ms("2026-08-17T00:00:00+02:00"),
      now: ms("2026-08-18T12:00:00+02:00"),
    })).toBeNull();
  });
});

describe("Check 8 — validaciones de Registrar contacto", () => {
  const actor = { type: "closer" as const, id: "00000000-0000-0000-0000-000000000000", name: "Test" };

  it("nota_libre con 3 caracteres → rechazado", async () => {
    const r = await registerContact({
      leadId: "lead-x", actor, actionType: "nota_libre", channel: "whatsapp", note: "abc",
    });
    expect(r).toEqual({ ok: false, error: "nota_corta" });
  });

  it("occurred_at hace 49h → rechazado", async () => {
    const r = await registerContact({
      leadId: "lead-x", actor, actionType: "enviar_info", channel: "whatsapp",
      occurredAt: new Date(Date.now() - 49 * 3_600_000).toISOString(),
    });
    expect(r).toEqual({ ok: false, error: "occurred_at_invalido" });
  });

  it("occurred_at en el futuro → rechazado", async () => {
    const r = await registerContact({
      leadId: "lead-x", actor, actionType: "enviar_info", channel: "whatsapp",
      occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(r).toEqual({ ok: false, error: "occurred_at_invalido" });
  });
});

describe("R5 — agendar_prueba cuenta como propuesta (fix Alicia)", () => {
  const lead = { ...BASE_LEAD, trial_attended_at: "2026-08-13T09:00:00+02:00" };
  const now = ms("2026-08-13T12:00:00+02:00");

  it("agendar_prueba posterior a asistencia apaga R5", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-13T10:00:00+02:00", "agendar_prueba")],
    }));
    expect(r.regla).not.toBe("R5");
  });

  it("enviar_enlace posterior a asistencia apaga R5", () => {
    const r = evaluateSemaforo(input({
      now, lead,
      contacts: [saliente("2026-08-13T10:00:00+02:00", "enviar_enlace")],
    }));
    expect(r.regla).not.toBe("R5");
  });
});

describe("A2 — trial/sesión agendada para HOY", () => {
  it("sesion_plan_at HOY sin resultado → amarillo A2", () => {
    const lead = {
      ...BASE_LEAD,
      sesion_plan_at: "2026-08-13T15:00:00+02:00",
    };
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T10:00:00+02:00"),
      lead,
      contacts: [saliente("2026-08-13T08:00:00+02:00")],
    }));
    expect(r.color).toBe("amarillo");
    expect(r.regla).toBe("A2");
  });

  it("sesion_plan_at HOY con trial_attended_at → NO es A2 (ya pasó)", () => {
    const lead = {
      ...BASE_LEAD,
      sesion_plan_at: "2026-08-13T09:00:00+02:00",
      trial_attended_at: "2026-08-13T09:30:00+02:00",
    };
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T10:00:00+02:00"),
      lead,
      contacts: [saliente("2026-08-13T09:35:00+02:00", "enviar_enlace")],
    }));
    expect(r.regla).not.toBe("A2");
  });
});

describe("eventoFuturo → verde V1 (cita agendada a futuro)", () => {
  it("trial_scheduled_at mañana sin resultado → verde V1 cita agendada", () => {
    const lead = {
      ...BASE_LEAD,
      trial_scheduled_at: "2026-08-14T09:00:00+02:00",
    };
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T12:00:00+02:00"),
      lead,
      contacts: [saliente("2026-08-13T10:00:00+02:00")],
    }));
    expect(r.color).toBe("verde");
    expect(r.regla).toBe("V1");
    expect(r.badge).toContain("Cita agendada");
  });

  it("sesion_plan_at mañana → verde V1 cita agendada", () => {
    const lead = {
      ...BASE_LEAD,
      sesion_plan_at: "2026-08-15T10:00:00+02:00",
    };
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T12:00:00+02:00"),
      lead,
      contacts: [saliente("2026-08-13T10:00:00+02:00")],
    }));
    expect(r.color).toBe("verde");
    expect(r.badge).toContain("Cita agendada");
  });
});

describe("FUERA — not_qualified", () => {
  it("status not_qualified → fuera", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T12:00:00+02:00"),
      lead: { ...BASE_LEAD, status: "not_qualified" },
    }));
    expect(r.color).toBe("fuera");
    expect(r.regla).toBe("FUERA");
  });

  it("status lost → fuera", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T12:00:00+02:00"),
      lead: { ...BASE_LEAD, status: "lost" },
    }));
    expect(r.color).toBe("fuera");
  });
});

describe("R1 — saliente posterior apaga el rojo", () => {
  it("saliente después del inbound → NO es R1", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T14:00:00+02:00"),
      contacts: [
        saliente("2026-08-13T08:00:00+02:00"),
        entrante("2026-08-13T09:00:00+02:00"),
        saliente("2026-08-13T10:00:00+02:00"),
      ],
    }));
    expect(r.regla).not.toBe("R1");
  });
});

describe("R3 — ventaPendiente como trigger", () => {
  it("ventaPendiente >3h hábiles sin pago → rojo R3", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T14:00:00+02:00"),
      contacts: [saliente("2026-08-13T08:00:00+02:00")],
      ventaPendiente: { lead_id: "lead-1", created_at: "2026-08-13T09:00:00+02:00" },
    }));
    expect(r.regla).toBe("R3");
    expect(r.causa).toBe("pago");
  });
});

describe("Setter — sus salientes solo apagan R4 (lead nuevo)", () => {
  const setterSaliente = (at: string, action = "confirmar_cita") => ({
    lead_id: "lead-1", direction: "saliente" as const, action_type: action,
    occurred_at: new Date(at).toISOString(), actor_type: "setter", actor_name: "María",
  });

  it("un contacto del setter apaga R4 (llamar primero es su función)", () => {
    const lead = { ...BASE_LEAD, created_at: "2026-08-13T08:00:00+02:00" };
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T09:00:00+02:00"), lead,
      contacts: [setterSaliente("2026-08-13T08:10:00+02:00")],
    }));
    expect(r.regla).not.toBe("R4");
  });

  it("un contacto del setter NO apaga R1 (respuesta sigue siendo del closer)", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T14:00:00+02:00"),
      contacts: [
        saliente("2026-08-13T08:00:00+02:00"),
        entrante("2026-08-13T09:00:00+02:00"),
        setterSaliente("2026-08-13T10:00:00+02:00"),
      ],
    }));
    expect(r.regla).toBe("R1");
    expect(r.causa).toBe("respuesta");
  });

  it("un contacto del setter NO apaga R3 (el pago es del closer)", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T14:00:00+02:00"),
      contacts: [
        saliente("2026-08-13T10:00:00+02:00", "enviar_enlace"),
        setterSaliente("2026-08-13T12:00:00+02:00"),
      ],
    }));
    expect(r.regla).toBe("R3");
  });

  it("un agendar_prueba del setter NO apaga R5 (post-clase es del closer)", () => {
    const lead = { ...BASE_LEAD, trial_attended_at: "2026-08-13T09:00:00+02:00" };
    const r = evaluateSemaforo(input({
      now: ms("2026-08-13T12:00:00+02:00"), lead,
      contacts: [
        saliente("2026-08-12T10:00:00+02:00"),
        setterSaliente("2026-08-13T10:00:00+02:00", "agendar_prueba"),
      ],
    }));
    expect(r.regla).toBe("R5");
  });
});

describe("Epoch C6 — la deuda histórica no genera rojos el día 1", () => {
  const epoch = ms("2026-08-17T00:00:00+02:00");

  it("inbound de antes del arranque no dispara R1", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-18T12:00:00+02:00"),
      epochMs: epoch,
      contacts: [
        saliente("2026-08-10T10:00:00+02:00"),
        entrante("2026-08-12T09:00:00+02:00"),   // pre-epoch
      ],
      tareas: [tarea("2026-08-20T10:00:00+02:00")],
    }));
    expect(r.color).toBe("verde");
  });

  it("inbound posterior al arranque SÍ dispara R1", () => {
    const r = evaluateSemaforo(input({
      now: ms("2026-08-18T12:00:00+02:00"),
      epochMs: epoch,
      contacts: [
        saliente("2026-08-17T08:30:00+02:00"),
        entrante("2026-08-18T08:00:00+02:00"),
      ],
    }));
    expect(r.regla).toBe("R1");
  });
});
