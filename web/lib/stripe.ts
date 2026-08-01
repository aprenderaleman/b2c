import Stripe from "stripe";

let _stripeUS: Stripe | null = null;
let _stripeDE: Stripe | null = null;

export function stripeUS(): Stripe {
  if (!_stripeUS) {
    const key = process.env.STRIPE_SECRET_KEY_US;
    if (!key) throw new Error("STRIPE_SECRET_KEY_US not set");
    _stripeUS = new Stripe(key);
  }
  return _stripeUS;
}

export function stripeDE(): Stripe {
  if (!_stripeDE) {
    const key = process.env.STRIPE_SECRET_KEY_DE;
    if (!key) throw new Error("STRIPE_SECRET_KEY_DE not set");
    _stripeDE = new Stripe(key);
  }
  return _stripeDE;
}

export function getStripeClient(account: "us" | "de"): Stripe {
  return account === "us" ? stripeUS() : stripeDE();
}

export function constructEvent(
  body: string | Buffer,
  signature: string,
  account: "us" | "de",
): Stripe.Event {
  const secret = account === "us"
    ? process.env.STRIPE_WEBHOOK_SECRET_US!
    : process.env.STRIPE_WEBHOOK_SECRET_DE!;
  const client = getStripeClient(account);
  return client.webhooks.constructEvent(body, signature, secret);
}

export async function findOrCreateCustomer(
  account: "us" | "de",
  opts: { email: string; name?: string; metadata?: Record<string, string> },
): Promise<string> {
  const stripe = getStripeClient(account);
  const existing = await stripe.customers.list({ email: opts.email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0].id;
  const customer = await stripe.customers.create({
    email: opts.email,
    name: opts.name,
    metadata: opts.metadata,
  });
  return customer.id;
}
