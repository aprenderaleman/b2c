import { describe, expect, it } from "vitest";
import { invoiceDedupWindow, isSameChargeCandidate, paymentIntentSucceededAt } from "./stripe-payment-dedup";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const inWindow = (iso: string, w: { fromIso: string; toIso: string }) =>
  iso >= w.fromIso && iso <= w.toIso;

// Caso real Valentina (invoice in_1UX79i…, 2026-11): finalizado el día 1,
// cobrado al 5.º intento el día 10.
const FINALIZED = "2026-11-01T23:23:59.000Z";
const PAID      = "2026-11-10T21:24:25.000Z";

describe("paymentIntentSucceededAt", () => {
  it("usa el created del cargo que tuvo éxito, no el del PI", () => {
    const d = paymentIntentSucceededAt({ chargeCreated: unix(PAID), eventCreated: unix(PAID) + 2 });
    expect(d.toISOString()).toBe(PAID);
  });

  it("sin cargo → created del evento (cron stripe-reconcile llega tarde)", () => {
    const d = paymentIntentSucceededAt({
      chargeCreated: null,
      eventCreated: unix(PAID),
      nowMs: Date.parse("2026-11-11T09:00:00.000Z"),
    });
    expect(d.toISOString()).toBe(PAID);
  });

  it("sin cargo ni evento → ahora", () => {
    const nowMs = Date.parse("2026-11-10T21:24:30.000Z");
    expect(paymentIntentSucceededAt({ nowMs }).getTime()).toBe(nowMs);
  });
});

describe("invoiceDedupWindow", () => {
  const retried = invoiceDedupWindow({ finalized_at: unix(FINALIZED), paid_at: unix(PAID) });

  it("invoice con reintentos: alcanza la fila del PI fechada en la finalización", () => {
    // Fila d582ed91 (paid_at = pi.created = finalización): antes quedaba fuera.
    expect(inWindow(FINALIZED, retried)).toBe(true);
    expect(retried.fromIso).toBe("2026-11-01T22:23:59.000Z");
    expect(retried.toIso).toBe("2026-11-10T22:24:25.000Z");
  });

  it("invoice con reintentos: alcanza la fila del PI fechada en el cobro real", () => {
    expect(inWindow(PAID, retried)).toBe(true);
  });

  it("no alcanza la renovación del mes anterior ni la del siguiente", () => {
    expect(inWindow("2026-10-01T23:24:10.000Z", retried)).toBe(false);
    expect(inWindow("2026-12-01T23:24:10.000Z", retried)).toBe(false);
  });

  it("cobro al primer intento: sigue siendo ±1h del paid_at", () => {
    const w = invoiceDedupWindow({ finalized_at: unix(PAID) - 3, paid_at: unix(PAID) });
    expect(w.fromIso).toBe("2026-11-10T20:24:22.000Z");
    expect(w.toIso).toBe("2026-11-10T22:24:25.000Z");
  });

  it("sin finalized_at → ±1h del paid_at (comportamiento anterior)", () => {
    const w = invoiceDedupWindow({ paid_at: unix(PAID) });
    expect(w.fromIso).toBe("2026-11-10T20:24:25.000Z");
    expect(w.toIso).toBe("2026-11-10T22:24:25.000Z");
    expect(w.paidAtMs).toBe(Date.parse(PAID));
  });

  it("finalized_at posterior al paid_at (datos raros) → no estrecha la ventana", () => {
    const w = invoiceDedupWindow({ finalized_at: unix(PAID) + 600, paid_at: unix(PAID) });
    expect(w.fromIso).toBe("2026-11-10T20:24:25.000Z");
  });

  it("se ancla al invoice, no a 'ahora' (evento recuperado horas después)", () => {
    const late = invoiceDedupWindow(
      { finalized_at: unix(FINALIZED), paid_at: unix(PAID) },
      Date.parse("2026-11-13T08:00:00.000Z"),
    );
    expect(late).toEqual(retried);
  });

  it("sin status_transitions → ±1h de ahora", () => {
    const nowMs = Date.parse("2026-11-10T21:30:00.000Z");
    const w = invoiceDedupWindow(null, nowMs);
    expect(w.fromIso).toBe("2026-11-10T20:30:00.000Z");
    expect(w.toIso).toBe("2026-11-10T22:30:00.000Z");
  });

  it("nearFromIso = paid_at − 1h (inicio de la ventana original)", () => {
    expect(retried.nearFromIso).toBe("2026-11-10T20:24:25.000Z");
  });
});

describe("isSameChargeCandidate", () => {
  const w = invoiceDedupWindow({ finalized_at: unix(FINALIZED), paid_at: unix(PAID) });
  const PI = "pi_3UX86V2KdZIeUfmj0n7grm2R";

  it("fila del PI fechada en la finalización (9 días antes) → mismo cobro", () => {
    // Formato de timestamp tal como lo devuelve Supabase.
    expect(isSameChargeCandidate({ paid_at: "2026-11-01T23:23:59+00:00", stripe_payment_intent_id: PI }, w)).toBe(true);
  });

  it("fila del PI fechada en el cobro real → mismo cobro", () => {
    expect(isSameChargeCandidate({ paid_at: "2026-11-10T21:24:25+00:00", stripe_payment_intent_id: PI }, w)).toBe(true);
  });

  it("pago manual sin PI durante el dunning (transferencia) → NO se fusiona", () => {
    expect(isSameChargeCandidate({ paid_at: "2026-11-05T10:00:00+00:00", stripe_payment_intent_id: null }, w)).toBe(false);
  });

  it("fila sin PI a ±1h del cobro (checkout de suscripción) → mismo cobro, como antes", () => {
    expect(isSameChargeCandidate({ paid_at: "2026-11-10T21:24:30+00:00", stripe_payment_intent_id: null }, w)).toBe(true);
  });

  it("fuera de la ventana → no, tenga PI o no", () => {
    expect(isSameChargeCandidate({ paid_at: "2026-10-01T23:23:42+00:00", stripe_payment_intent_id: PI }, w)).toBe(false);
    expect(isSameChargeCandidate({ paid_at: "2026-11-11T00:00:00+00:00", stripe_payment_intent_id: PI }, w)).toBe(false);
    expect(isSameChargeCandidate({ paid_at: null, stripe_payment_intent_id: PI }, w)).toBe(false);
  });
});
