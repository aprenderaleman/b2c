# /admin/empresa — Dashboard de Metricas Empresa

## Que muestra

Vista ejecutiva con metricas financieras y operativas en tiempo real:

- **KPIs principales**: Beneficio Bruto, Beneficio Neto, Margen Neto %, Ingresos
- **Embudo de conversion**: Lead → Prueba → Asistencia → Venta con tasas
- **Marketing**: CPL, CAC, LTV, LTV/CAC, ROAS
- **Alertas automaticas**: Rojo (margen bajo, CAC>LTV) y Verde (condiciones para escalar)
- **Graficos**: Evolucion diaria de leads e ingresos (Recharts)
- **Costes fijos**: Gestion en /admin/empresa/costes

## Arquitectura

```
Stripe US/DE ──webhook──> /api/webhooks/stripe/us|de → payments table
Google Ads ───cron 4am──> /api/cron/google-ads-sync  → google_ads_daily table
Manual ──────────────────> business_expenses table
Admin CRUD ──────────────> costes_fijos table
                                    │
                        ┌───────────┴──────────┐
                        │  lib/empresa.ts       │
                        │  getEmpresaMetrics()  │
                        │  (reutiliza finance.ts)│
                        └───────────┬──────────┘
                                    │
                        /admin/empresa (RSC)
```

## Tablas nuevas

| Tabla | Migracion | Proposito |
|-------|-----------|-----------|
| `costes_fijos` | 060 | Costes fijos mensuales (Vercel, Supabase, etc.) |
| `stripe_events` | 061 | Dedup de webhooks Stripe por event_id |
| `google_ads_daily` | 062 | Metricas diarias por campana de Google Ads |

## Calculos

- **Beneficio Bruto** = Ingresos − Nomina profesores
- **Beneficio Neto** = Bruto − Gastos variables − Costes fijos (prorrateados) 
- **CPL** = Gasto Ads / Leads totales
- **CAC** = (Ads + Fijos + Variables) / Conversiones
- **LTV** = Promedio de ingresos totales por estudiante
- **ROAS** = Ingresos / Gasto Ads

Los costes fijos se prorratean al periodo seleccionado (ej: 7 dias = 7/30 del mensual).

## API Keys necesarias

### Stripe

| Variable | Donde obtenerla |
|----------|----------------|
| `STRIPE_SECRET_KEY_US` | https://dashboard.stripe.com/apikeys (cuenta Linguify Global LLC) |
| `STRIPE_SECRET_KEY_DE` | https://dashboard.stripe.com/apikeys (cuenta DE) |
| `STRIPE_WEBHOOK_SECRET_US` | Se genera al crear el webhook (ver abajo) |
| `STRIPE_WEBHOOK_SECRET_DE` | Se genera al crear el webhook (ver abajo) |

**Configurar webhooks en Stripe Dashboard:**

1. Ir a https://dashboard.stripe.com/webhooks (cuenta US)
2. Click "Add endpoint"
3. URL: `https://tu-dominio.vercel.app/api/webhooks/stripe/us`
4. Eventos: `checkout.session.completed`, `payment_intent.succeeded`
5. Copiar el "Signing secret" → ponerlo como `STRIPE_WEBHOOK_SECRET_US`
6. Repetir pasos 1-5 para la cuenta DE con URL `.../stripe/de`

**Backfill historico (una sola vez):**
```bash
curl -X POST https://tu-dominio.vercel.app/api/cron/stripe-backfill \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Google Ads

| Variable | Donde obtenerla |
|----------|----------------|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | https://ads.google.com/aw/apicenter (Herramientas → API Center) |
| `GOOGLE_ADS_CLIENT_ID` | https://console.cloud.google.com/apis/credentials (OAuth 2.0 Client) |
| `GOOGLE_ADS_CLIENT_SECRET` | Mismo lugar que CLIENT_ID |
| `GOOGLE_ADS_REFRESH_TOKEN` | Generado con OAuth playground o script |
| `GOOGLE_ADS_CUSTOMER_ID` | ID de la cuenta Google Ads (formato: 123-456-7890) |

**Activar Google Ads API:**

1. Ir a https://console.cloud.google.com/apis/library
2. Buscar "Google Ads API" → Habilitar
3. Crear credenciales OAuth 2.0 (tipo "Web application")
4. Generar refresh token con el OAuth playground:
   - https://developers.google.com/oauthplayground/
   - Scope: `https://www.googleapis.com/auth/adwords`
   - Autorizar y obtener refresh_token

## Tests

```bash
cd web && npm test
```

32 tests unitarios que validan: margen bruto/neto, CPL, CAC, ROAS, LTV/CAC, 
tasas del funnel, prorrateo de costes fijos, conversion de monedas, y logica de alertas.
