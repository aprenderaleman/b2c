/**
 * Tests de las definiciones de cadenas — valida la estructura
 * declarativa para evitar regresiones silenciosas (paso que desaparece,
 * delay que cambia, flag perdido).
 *
 * Son puras — importan el objeto literal, no tocan BD.
 */
import { describe, it, expect } from "vitest";
import { CHAIN_DEFINITIONS, getChainDef } from "./chain-definitions";

const H = 3_600_000;
const D = 86_400_000;
const M = 60_000;

// ── sesion_attended ────────────────────────────────────────────────

describe("sesion_attended", () => {
  const def = getChainDef("sesion_attended");

  it("tiene 4 pasos", () => {
    expect(def.steps).toHaveLength(4);
  });

  it("paso 0 se ejecuta inline (delayMs = 0)", () => {
    expect(def.steps[0].delayMs).toBe(0);
  });

  it("delays: T+0, T+24h, T+3d, T+7d", () => {
    expect(def.steps.map(s => s.delayMs)).toEqual([0, 24 * H, 3 * D, 7 * D]);
  });

  it("todos los pasos tienen skipIfPaid", () => {
    for (const step of def.steps) {
      expect(step.skipIfPaid).toBe(true);
    }
  });

  it("último paso setea en_reactivacion", () => {
    expect(def.steps.at(-1)!.onComplete?.setStatus).toBe("en_reactivacion");
  });

  it("templateKind coincide con el chain type", () => {
    for (const step of def.steps) {
      expect(step.templateKind).toBe("sesion_attended");
    }
  });

  it("sub_n secuencial 1-4", () => {
    expect(def.steps.map(s => s.templateSubN)).toEqual([1, 2, 3, 4]);
  });

  it("NO tiene bypassPause (respeta pause de sesiones futuras)", () => {
    expect(def.bypassPause).toBeFalsy();
  });
});

// ── sesion_absent ──────────────────────────────────────────────────

describe("sesion_absent", () => {
  const def = getChainDef("sesion_absent");

  it("tiene 3 pasos", () => {
    expect(def.steps).toHaveLength(3);
  });

  it("paso 0 NO es inline — tiene 20 minutos de delay", () => {
    expect(def.steps[0].delayMs).toBe(20 * M);
  });

  it("delays: T+20min, T+24h, T+3d", () => {
    expect(def.steps.map(s => s.delayMs)).toEqual([20 * M, 24 * H, 3 * D]);
  });

  it("bypassPause = true (rescue transaccional)", () => {
    expect(def.bypassPause).toBe(true);
  });

  it("último paso setea en_reactivacion", () => {
    expect(def.steps.at(-1)!.onComplete?.setStatus).toBe("en_reactivacion");
  });

  it("templateKind coincide con el chain type", () => {
    for (const step of def.steps) {
      expect(step.templateKind).toBe("sesion_absent");
    }
  });
});

// ── chain2_link_sent ───────────────────────────────────────────────

describe("chain2_link_sent", () => {
  const def = getChainDef("chain2_link_sent");

  it("tiene 3 pasos", () => {
    expect(def.steps).toHaveLength(3);
  });

  it("delays: T+3h, T+24h, T+48h", () => {
    expect(def.steps.map(s => s.delayMs)).toEqual([3 * H, 24 * H, 48 * H]);
  });

  it("todos los pasos tienen skipIfPaid", () => {
    for (const step of def.steps) {
      expect(step.skipIfPaid).toBe(true);
    }
  });

  it("paso 0 genera tarea de closer alta prioridad (llamada_rescate)", () => {
    const task = def.steps[0].closerTask;
    expect(task).toBeDefined();
    expect(task!.tipo).toBe("llamada_rescate");
    expect(task!.prioridad).toBe("alta");
  });

  it("último paso tiene adminAlert y preludeTestimonial", () => {
    const last = def.steps.at(-1)!;
    expect(last.adminAlert).toBe(true);
    expect(last.preludeTestimonial).toBe(true);
  });
});

// ── chain4_absent (trial, no sesión) ──────────────────────────────

describe("chain4_absent", () => {
  const def = getChainDef("chain4_absent");

  it("bypassPause = true (rescue transaccional)", () => {
    expect(def.bypassPause).toBe(true);
  });

  it("paso 0 a los 20 min", () => {
    expect(def.steps[0].delayMs).toBe(20 * M);
  });

  it("último paso setea en_reactivacion", () => {
    expect(def.steps.at(-1)!.onComplete?.setStatus).toBe("en_reactivacion");
  });
});

// ── chain6_cancel ──────────────────────────────────────────────────

describe("chain6_cancel", () => {
  const def = getChainDef("chain6_cancel");

  it("bypassPause = true (rescue transaccional)", () => {
    expect(def.bypassPause).toBe(true);
  });
});

// ── Cadenas inline (delayMs = 0 en step 0) ────────────────────────

describe("cadenas con paso 0 inline", () => {
  for (const type of ["chain8e_seguimiento", "chain8g_reactivacion", "sesion_attended"] as const) {
    it(`${type} tiene delayMs = 0 en paso 0`, () => {
      expect(getChainDef(type).steps[0].delayMs).toBe(0);
    });
  }
});

// ── welcome_week ──────────────────────────────────────────────────

describe("welcome_week", () => {
  const def = getChainDef("welcome_week");

  it("tiene 4 pasos", () => {
    expect(def.steps).toHaveLength(4);
  });

  it("paso 1 (T+24h) tiene celebrationIfUsed: hans", () => {
    expect(def.steps[1].celebrationIfUsed).toBe("hans");
  });

  it("paso 2 (T+3d) tiene celebrationIfUsed: schule", () => {
    expect(def.steps[2].celebrationIfUsed).toBe("schule");
  });

  it("último paso setea student_active", () => {
    expect(def.steps.at(-1)!.onComplete?.setStatus).toBe("student_active");
  });

  it("último paso tiene setStatePhase para Python", () => {
    expect(def.steps.at(-1)!.setStatePhase).toBe("AWAITING_WELCOME_CHECKIN");
  });
});

// ── Invariantes globales ──────────────────────────────────────────

describe("invariantes de todas las cadenas", () => {
  const allChains = Object.values(CHAIN_DEFINITIONS);

  it("cada cadena tiene un label no vacío", () => {
    for (const chain of allChains) {
      expect(chain.label.length).toBeGreaterThan(0);
    }
  });

  it("los delays son no-decrecientes dentro de cada cadena", () => {
    for (const chain of allChains) {
      for (let i = 1; i < chain.steps.length; i++) {
        expect(chain.steps[i].delayMs).toBeGreaterThanOrEqual(chain.steps[i - 1].delayMs);
      }
    }
  });

  it("templateSubN consecutivos en cada cadena (sin huecos)", () => {
    for (const chain of allChains) {
      const subs = chain.steps.map(s => s.templateSubN);
      for (let i = 1; i < subs.length; i++) {
        expect(subs[i]).toBe(subs[i - 1] + 1);
      }
    }
  });

  it("todos los channels son whatsapp o email", () => {
    for (const chain of allChains) {
      for (const step of chain.steps) {
        for (const ch of step.channels) {
          expect(["whatsapp", "email"]).toContain(ch);
        }
      }
    }
  });

  it("onComplete solo en el último paso de cada cadena", () => {
    for (const chain of allChains) {
      for (let i = 0; i < chain.steps.length - 1; i++) {
        if (chain.steps[i].onComplete) {
          throw new Error(`${chain.type} tiene onComplete en paso ${i} (no es el último)`);
        }
      }
    }
  });

  it("cadenas de rescue tienen bypassPause", () => {
    for (const type of ["chain4_absent", "chain6_cancel", "sesion_absent"] as const) {
      expect(getChainDef(type).bypassPause).toBe(true);
    }
  });
});
