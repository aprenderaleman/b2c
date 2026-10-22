/**
 * Catálogo central de precios, comisiones y bonos.
 *
 * Lee de las tablas catalog_* y cachea en memoria (TTL 5 min).
 * system_config.catalog_active_version decide qué versión ven los nuevos
 * alumnos; los existentes quedan fijados a su catalog_version_id (cohorte).
 */
import { supabaseAdmin } from "./supabase";

// ── Types ────────────────────────────────────────────────────────────

export type CatalogVersion = {
  id: string;
  version: string;
  effective_at: string;
  description: string | null;
};

export type CatalogPlan = {
  id: string;
  version_id: string;
  slug: string;
  label: string;
  type: "subscription" | "one_time" | "kids" | "duo";
  price_cents: number;
  classes_total: number | null;
  classes_per_month: number | null;
  stripe_link: string | null;
  surcharge_pct: number;
  sort_order: number;
};

export type CatalogCommission = {
  id: string;
  version_id: string;
  plan_slug: string;
  seller_id: string | null;
  amount_cents: number;
};

export type CatalogBono = {
  id: string;
  version_id: string;
  plan_slug: string;
  bono_cents: number;
  e2_factor: number;
  renewal_full: boolean;
};

export type CatalogBonusLadder = {
  id: string;
  version_id: string;
  threshold: number;
  multiplier: number;
  counts_e1: boolean;
  counts_e2: boolean;
  counts_renewal: boolean;
  duo_per_person: boolean;
  reset_day: number;
};

export type FullCatalog = {
  version: CatalogVersion;
  plans: CatalogPlan[];
  commissions: CatalogCommission[];
  bonos: CatalogBono[];
  ladder: CatalogBonusLadder | null;
};

// ── Cache ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { data: T; ts: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

export function invalidateCache() {
  cache.clear();
}

// ── Queries ──────────────────────────────────────────────────────────

export async function getActiveVersionTag(): Promise<string> {
  return cached("active_version_tag", async () => {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("system_config")
      .select("value")
      .eq("key", "catalog_active_version")
      .single();
    return (data?.value as string) ?? "v1";
  });
}

export async function getAllVersions(): Promise<CatalogVersion[]> {
  return cached("all_versions", async () => {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("catalog_versions")
      .select("*")
      .order("effective_at");
    return (data ?? []) as CatalogVersion[];
  });
}

export async function getVersionByTag(tag: string): Promise<CatalogVersion | null> {
  const all = await getAllVersions();
  return all.find((v) => v.version === tag) ?? null;
}

export async function getVersionById(id: string): Promise<CatalogVersion | null> {
  const all = await getAllVersions();
  return all.find((v) => v.id === id) ?? null;
}

async function loadFull(versionId: string): Promise<FullCatalog | null> {
  return cached(`full_${versionId}`, async () => {
    const sb = supabaseAdmin();

    const [vRes, pRes, cRes, bRes, lRes] = await Promise.all([
      sb.from("catalog_versions").select("*").eq("id", versionId).single(),
      sb.from("catalog_plans").select("*").eq("version_id", versionId).order("sort_order"),
      sb.from("catalog_commissions").select("*").eq("version_id", versionId),
      sb.from("catalog_bonos").select("*").eq("version_id", versionId),
      sb.from("catalog_bonus_ladder").select("*").eq("version_id", versionId),
    ]);

    if (!vRes.data) return null;

    return {
      version: vRes.data as CatalogVersion,
      plans: (pRes.data ?? []) as CatalogPlan[],
      commissions: (cRes.data ?? []) as CatalogCommission[],
      bonos: (bRes.data ?? []) as CatalogBono[],
      ladder: ((lRes.data ?? [])[0] as CatalogBonusLadder) ?? null,
    };
  });
}

/** Full catalog for the globally active version. */
export async function getActiveCatalog(): Promise<FullCatalog> {
  const tag = await getActiveVersionTag();
  const ver = await getVersionByTag(tag);
  if (!ver) throw new Error(`Catalog version '${tag}' not found`);
  const full = await loadFull(ver.id);
  if (!full) throw new Error(`Catalog data for '${tag}' not found`);
  return full;
}

/** Full catalog for a specific version (by id). */
export async function getCatalogByVersionId(versionId: string): Promise<FullCatalog | null> {
  return loadFull(versionId);
}

/** Full catalog for a student's cohort version — falls back to active. */
export async function getStudentCatalog(studentCatalogVersionId: string | null): Promise<FullCatalog> {
  if (studentCatalogVersionId) {
    const cat = await loadFull(studentCatalogVersionId);
    if (cat) return cat;
  }
  return getActiveCatalog();
}

// ── Convenience getters ─────────────────────────────────────────────

export async function getPlan(catalog: FullCatalog, slug: string): Promise<CatalogPlan | undefined> {
  return catalog.plans.find((p) => p.slug === slug);
}

export async function getSubscriptionPlans(catalog: FullCatalog): Promise<CatalogPlan[]> {
  return catalog.plans.filter((p) => p.type === "subscription");
}

export async function getOneTimePlans(catalog: FullCatalog): Promise<CatalogPlan[]> {
  return catalog.plans.filter((p) => p.type === "one_time");
}

/**
 * Monthly commission for a student on a given plan.
 * Checks seller-specific rate first, falls back to default.
 */
export function getCommissionCents(
  catalog: FullCatalog,
  planSlug: string,
  sellerId?: string | null,
): number {
  if (sellerId) {
    const specific = catalog.commissions.find(
      (c) => c.plan_slug === planSlug && c.seller_id === sellerId,
    );
    if (specific) return specific.amount_cents;
  }
  const def = catalog.commissions.find(
    (c) => c.plan_slug === planSlug && !c.seller_id,
  );
  return def?.amount_cents ?? 0;
}

/** Bono de cierre for a plan slug. */
export function getBonoCents(catalog: FullCatalog, planSlug: string): number {
  const b = catalog.bonos.find((x) => x.plan_slug === planSlug);
  return b?.bono_cents ?? 0;
}

/** E2 factor for a plan slug. */
export function getE2Factor(catalog: FullCatalog, planSlug: string): number {
  const b = catalog.bonos.find((x) => x.plan_slug === planSlug);
  return b?.e2_factor ?? 0.5;
}

/** Whether renewals get the full bono. */
export function isRenewalFull(catalog: FullCatalog, planSlug: string): boolean {
  const b = catalog.bonos.find((x) => x.plan_slug === planSlug);
  return b?.renewal_full ?? true;
}

/**
 * Given the number of qualifying sales this month, returns the
 * bonus multiplier (1 = normal, 2 = doubled, etc.).
 */
export function getBonusMultiplier(catalog: FullCatalog, salesCount: number): number {
  if (!catalog.ladder) return 1;
  if (salesCount >= catalog.ladder.threshold) return catalog.ladder.multiplier;
  return 1;
}

/** Whether the catalog flag is active (i.e. switched to v2+). */
export async function isCatalogActive(): Promise<boolean> {
  const tag = await getActiveVersionTag();
  return tag !== "v1";
}

// ── Bridge: same shape as trial-packs.ts but from catalog ───────────

import { GOAL_CLASSES, GOAL_LABELS, type RitmoId, type GoalId, type GoalDetail, type Ritmo, type OneTimePack } from "./trial-packs";

const RITMO_EMOJI: Record<string, string> = {
  viajero: "🌍", estandar: "⭐", intensivo: "🚀", vip_express: "👑",
};

function planToRitmo(plan: CatalogPlan): Ritmo {
  const cpm = plan.classes_per_month ?? 6;
  const pricePerMonth = plan.price_cents / 100;
  const goals = (Object.keys(GOAL_CLASSES) as GoalId[]).map((id): GoalDetail => {
    const classes = GOAL_CLASSES[id];
    const months = Math.ceil(classes / cpm);
    return {
      id,
      label: GOAL_LABELS[id],
      classes,
      months,
      totalCents: months * plan.price_cents,
      refId: `goal_${id === "a1_a2" ? "a1a2" : id === "fluidez_total" ? "zero_to_b1" : id}`,
    };
  });
  return {
    id: plan.slug as RitmoId,
    name: plan.label,
    emoji: RITMO_EMOJI[plan.slug] ?? "📦",
    pricePerMonth,
    classesPerMonth: cpm,
    baseUrl: plan.stripe_link ?? "",
    goals,
  };
}

function planToOneTimePack(plan: CatalogPlan): OneTimePack {
  return {
    id: plan.slug as GoalId,
    name: plan.label,
    classes: plan.classes_total ?? GOAL_CLASSES[plan.slug as GoalId] ?? 32,
    priceCents: plan.price_cents,
    url: plan.stripe_link ?? "",
  };
}

/** RITMOS from catalog — same shape as trial-packs.ts RITMOS. */
export async function getCatalogRitmos(catalog?: FullCatalog): Promise<Ritmo[]> {
  const cat = catalog ?? await getActiveCatalog();
  return cat.plans
    .filter((p) => p.type === "subscription")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(planToRitmo);
}

/** ONE_TIME_PACKS from catalog. */
export async function getCatalogOneTimePacks(catalog?: FullCatalog): Promise<OneTimePack[]> {
  const cat = catalog ?? await getActiveCatalog();
  return cat.plans
    .filter((p) => p.type === "one_time")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(planToOneTimePack);
}

/** Kids pack from catalog. */
export async function getCatalogKidsPack(catalog?: FullCatalog) {
  const cat = catalog ?? await getActiveCatalog();
  const kids = cat.plans.find((p) => p.type === "kids");
  if (!kids) return null;
  return {
    id: "kids" as const,
    name: kids.label,
    classes: kids.classes_total ?? 24,
    priceCents: kids.price_cents,
    urlSingle: kids.stripe_link ?? "",
    urlFlexible: kids.stripe_link ?? "",
    labels: {
      single: `Pago único (${(kids.price_cents / 100).toLocaleString("es-ES")} €)`,
      flexible: `Paga durante tu formación`,
    },
  };
}
