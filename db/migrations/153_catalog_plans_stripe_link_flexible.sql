-- 153: segundo link de Stripe por plan (pago fraccionado / "paga durante tu formación").
-- Hoy solo lo usa el pack Kids (lib/trial-packs.ts KIDS_PACK.urlFlexible).
ALTER TABLE catalog_plans ADD COLUMN IF NOT EXISTS stripe_link_flexible text;
COMMENT ON COLUMN catalog_plans.stripe_link_flexible IS 'Link de Stripe para pago fraccionado; null = usar stripe_link';

-- Kids v2: link "paga durante tu formación" (lib/trial-packs.ts KIDS_PACK.urlFlexible)
UPDATE catalog_plans
   SET stripe_link_flexible = 'https://buy.stripe.com/3cIaEQ1eR5Hu7RZ5H10co0q'
 WHERE slug = 'kids' AND version_id = '22222222-0000-0000-0000-000000000002';
