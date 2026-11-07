/** Gelfis 2026-11-08: completar catálogo v2 (packs pago único + kids + links Stripe) y activarlo
 *  SOLO si la salida del puente (getCatalogRitmos/OneTimePacks/KidsPack) coincide con lib/trial-packs.ts. */
import { supabaseAdmin } from "@/lib/supabase";
import { RITMOS, ONE_TIME_PACKS, KIDS_PACK, GOAL_CLASSES } from "@/lib/trial-packs";
import { getCatalogByVersionId, getCatalogRitmos, getCatalogOneTimePacks, getCatalogKidsPack, invalidateCache } from "@/lib/catalog";
const V2 = "22222222-0000-0000-0000-000000000002";
const APPLY = process.argv.includes("--apply");

(async () => {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from("catalog_plans").select("slug, stripe_link").eq("version_id", V2);
  const have = new Map((existing ?? []).map((p: { slug: string; stripe_link: string | null }) => [p.slug, p.stripe_link]));

  // 1. Packs de pago único + kids
  const rows = [
    ...ONE_TIME_PACKS.map((p, i) => ({ version_id: V2, slug: p.id, label: p.name, type: "one_time", price_cents: p.priceCents,
      classes_total: GOAL_CLASSES[p.id], classes_per_month: null, stripe_link: p.url, surcharge_pct: 0, sort_order: 10 + i })),
    { version_id: V2, slug: "kids", label: KIDS_PACK.name, type: "kids", price_cents: KIDS_PACK.priceCents, classes_total: KIDS_PACK.classes,
      classes_per_month: null, stripe_link: KIDS_PACK.urlSingle, surcharge_pct: 0, sort_order: 20 },
  ].filter(r => !have.has(r.slug));
  if (rows.length) { const { error } = await sb.from("catalog_plans").insert(rows); if (error) throw error; }
  console.log("insertados:", rows.map(r => r.slug));

  // 2. Links Stripe en suscripciones v2
  for (const r of RITMOS) {
    if (have.get(r.id) === r.baseUrl) continue;
    const { error } = await sb.from("catalog_plans").update({ stripe_link: r.baseUrl }).eq("version_id", V2).eq("slug", r.id);
    if (error) throw error; console.log("link", r.id, "→", r.baseUrl);
  }
  // Kids flexible (solo si la migración 153 ya está aplicada)
  const { error: kfErr } = await sb.from("catalog_plans").update({ stripe_link_flexible: KIDS_PACK.urlFlexible }).eq("version_id", V2).eq("slug", "kids");
  console.log("kids flexible:", kfErr ? `pendiente (${kfErr.message})` : "ok");

  // 3. Comparación puente vs constantes
  invalidateCache();
  const cat = await getCatalogByVersionId(V2); if (!cat) throw new Error("no v2");
  const diffs: string[] = [];
  const cmp = (path: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${path}: catálogo=${JSON.stringify(a)} código=${JSON.stringify(b)}`); };
  const cr = await getCatalogRitmos(cat);
  cmp("ritmos.ids", cr.map(r => r.id), RITMOS.map(r => r.id));
  for (const r of RITMOS) { const c = cr.find(x => x.id === r.id); if (!c) { diffs.push(`ritmo ${r.id} falta`); continue; }
    for (const k of ["name", "emoji", "pricePerMonth", "classesPerMonth", "baseUrl"] as const) cmp(`ritmo ${r.id}.${k}`, c[k], r[k]);
    cmp(`ritmo ${r.id}.goals`, c.goals, r.goals); }
  const co = await getCatalogOneTimePacks(cat);
  cmp("oneTime", co, ONE_TIME_PACKS);
  const ck = await getCatalogKidsPack(cat);
  cmp("kids", ck && { id: ck.id, name: ck.name, classes: ck.classes, priceCents: ck.priceCents, urlSingle: ck.urlSingle }, { id: KIDS_PACK.id, name: KIDS_PACK.name, classes: KIDS_PACK.classes, priceCents: KIDS_PACK.priceCents, urlSingle: KIDS_PACK.urlSingle });
  if (ck?.urlFlexible !== KIDS_PACK.urlFlexible) console.log("AVISO kids.urlFlexible:", ck?.urlFlexible, "(esperado", KIDS_PACK.urlFlexible + ") — se corrige al aplicar la migración 153");
  if (ck) cmp("kids.labels", ck.labels, KIDS_PACK.labels);

  if (diffs.length) { console.log("DIFERENCIAS — NO se activa:\n  " + diffs.join("\n  ")); process.exit(2); }
  console.log("puente v2 == trial-packs.ts ✔");
  if (!APPLY) { console.log("(sin --apply: flag no tocado)"); return; }
  const { error } = await sb.from("system_config").update({ value: "v2", updated_at: new Date().toISOString() }).eq("key", "catalog_active_version");
  if (error) throw error;
  console.log("catalog_active_version → v2");
})().catch(e => { console.error(e); process.exit(1); });
