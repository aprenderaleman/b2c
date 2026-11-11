/**
 * Reglas de tiempo para cruzar la fila que inserta payment_intent.succeeded
 * con la del invoice.paid del MISMO cobro (webhook de Stripe).
 *
 * Caso Valentina 2026-11-10: invoice de suscripción cobrado al 5.º intento,
 * 9 días después de finalizarse. La fila del PI se guardaba con
 * `pi.created` (= fecha de finalización del invoice, no la del cobro) y el
 * dedup heurístico del invoice buscaba a ±1h de su paid_at → no la veía y
 * el cobro quedaba registrado dos veces.
 *
 * Funciones puras (sin Stripe ni Supabase) para poder testearlas.
 */

const HOUR_MS = 3600_000;

/**
 * Momento en que el PaymentIntent se cobró DE VERDAD.
 *
 * `pi.created` no sirve: en un invoice con reintentos el PI se crea al
 * finalizar el invoice y se reutiliza en cada intento. Orden de preferencia:
 *   1. `created` del latest_charge (el cargo que tuvo éxito).
 *   2. `created` del evento payment_intent.succeeded (correcto también
 *      cuando el evento llega tarde vía el cron stripe-reconcile).
 *   3. Ahora.
 * Todos en segundos Unix, como los manda Stripe.
 */
export function paymentIntentSucceededAt(opts: {
  chargeCreated?: number | null;
  eventCreated?: number | null;
  nowMs?: number;
}): Date {
  if (opts.chargeCreated) return new Date(opts.chargeCreated * 1000);
  if (opts.eventCreated) return new Date(opts.eventCreated * 1000);
  return new Date(opts.nowMs ?? Date.now());
}

/**
 * Ventana de `payments.paid_at` en la que una fila SIN stripe_invoice_id,
 * del mismo alumno e importe, se considera el mismo cobro que este invoice.
 *
 *   desde = min(finalized_at, paid_at) − 1h
 *   hasta = paid_at + 1h
 *
 * El límite inferior baja hasta la finalización para alcanzar filas del PI
 * fechadas ahí (las antiguas con pi.created, o un cargo iniciado días antes
 * de confirmarse, p.ej. SEPA). Se ancla a los timestamps del INVOICE, no a
 * "ahora", para que funcione igual cuando el evento llega tarde vía el cron
 * stripe-reconcile. La renovación anterior queda fuera: es ~1 mes anterior
 * a la finalización y además ya lleva su stripe_invoice_id.
 *
 * `nearFromIso` (= paid_at − 1h) marca dónde empieza la ventana original
 * de ±1h. En el tramo ampliado [fromIso, nearFromIso) solo deben casar
 * filas con stripe_payment_intent_id — ver `isSameChargeCandidate`.
 */
export function invoiceDedupWindow(
  transitions: { finalized_at?: number | null; paid_at?: number | null } | null | undefined,
  nowMs: number = Date.now(),
): { fromIso: string; nearFromIso: string; toIso: string; paidAtMs: number } {
  const paidAtMs = transitions?.paid_at ? transitions.paid_at * 1000 : nowMs;
  const finalizedMs = transitions?.finalized_at ? transitions.finalized_at * 1000 : paidAtMs;
  return {
    fromIso: new Date(Math.min(finalizedMs, paidAtMs) - HOUR_MS).toISOString(),
    nearFromIso: new Date(paidAtMs - HOUR_MS).toISOString(),
    toIso: new Date(paidAtMs + HOUR_MS).toISOString(),
    paidAtMs,
  };
}

/**
 * ¿Esta fila (sin stripe_invoice_id, mismo alumno e importe) es el mismo
 * cobro que el invoice?
 *
 *   - A ±1h del paid_at: sí, cualquier fila (comportamiento de siempre;
 *     cubre también la fila del checkout de suscripción, que no trae PI).
 *   - En el tramo ampliado (desde la finalización): solo si tiene
 *     stripe_payment_intent_id. Así un pago registrado a mano durante el
 *     dunning (p.ej. transferencia porque la tarjeta fallaba) NO se
 *     fusiona con el cobro de Stripe si este entra después — serían dos
 *     pagos reales y deben verse los dos.
 *
 * Espejo en JS del filtro que el webhook aplica en SQL.
 */
export function isSameChargeCandidate(
  row: { paid_at: string | null; stripe_payment_intent_id: string | null },
  window: { fromIso: string; nearFromIso: string; toIso: string },
): boolean {
  if (!row.paid_at) return false;
  const t = Date.parse(row.paid_at);
  if (t < Date.parse(window.fromIso) || t > Date.parse(window.toIso)) return false;
  return t >= Date.parse(window.nearFromIso) || !!row.stripe_payment_intent_id;
}
