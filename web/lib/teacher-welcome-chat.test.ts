import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabaseAdmin: () => { throw new Error("sin BD en este test"); } }));
vi.mock("./chat", () => ({ ensureDirectChat: vi.fn(), sendMessage: vi.fn() }));

import { renderTeacherWelcomeChat } from "./teacher-welcome-chat";

describe("renderTeacherWelcomeChat", () => {
  it("usa el nombre de pila y el copy aprobado", () => {
    const t = renderTeacherWelcomeChat("Constanza Kuch Rojano");
    expect(t.startsWith("¡Hola Constanza! Soy Gelfis. Es un placer tenerte en el equipo de Aprender-Aleman.de 🎉")).toBe(true);
    expect(t).toContain("Revisa el documento de bienvenida que te llegó por correo, principalmente el guion para las clases de prueba, y avísame si te surge cualquier duda.");
    expect(t).toContain("Estoy por aquí para lo que necesites.");
    expect(t.endsWith("— Gelfis")).toBe(true);
  });
  it("el saludo no asume género (ni 'bienvenido' ni 'bienvenida' al equipo)", () => {
    const saludo = renderTeacherWelcomeChat("Simon Heimler").split("\n\n")[0];
    expect(saludo).toBe("¡Hola Simon! Soy Gelfis. Es un placer tenerte en el equipo de Aprender-Aleman.de 🎉");
    expect(saludo).not.toMatch(/bienvenid[oa]/i);
  });
  it("sin nombre sigue siendo legible", () => {
    expect(renderTeacherWelcomeChat(null).startsWith("¡Hola! Soy Gelfis.")).toBe(true);
    expect(renderTeacherWelcomeChat("   ").startsWith("¡Hola! Soy Gelfis.")).toBe(true);
  });
});
