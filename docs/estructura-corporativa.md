# Estructura Corporativa y Operativa — Aprender-Aleman.de

Documento maestro de la academia. Última actualización: 2026-08-02.

---

## 1. Entidad Legal

| Campo | Detalle |
|-------|---------|
| Nombre | **Linguify Global LLC** |
| Jurisdicción | Wyoming, USA |
| Tipo | Single-member LLC (disregarded entity para IRS) |
| Miembro único | Gelfis Horn |
| Registered Agent | (Wyoming) — verificar en el Annual Report filing |
| Fecha constitución | 2025 |
| EIN (IRS) | Asignado — necesario para abrir Mercury y Stripe US |

### Qué contiene la LLC

- Toda la propiedad intelectual (marca, dominio, código, currículo)
- Contratos con profesores (freelance agreements)
- Contratos con closers
- Cuentas bancarias (Mercury) y procesadores de pago (Stripe US + DE)
- Suscripciones SaaS (Vercel, Supabase, Anthropic, LiveKit, etc.)

### Obligaciones anuales

| Obligación | Frecuencia | Detalle |
|------------|-----------|---------|
| Wyoming Annual Report | Anual (aniversario de constitución) | ~$60, se paga online en wyoming.gov |
| IRS Form 1040 + Schedule C | Anual (15 abril) | Reportar ingresos/gastos de la LLC como ingreso personal |
| FBAR / FinCEN 114 | Anual (15 abril, ext. oct) | Si hay cuentas fuera de US con >$10K agregado |
| FATCA (Form 8938) | Anual con 1040 | Si activos financieros extranjeros superan threshold |
| Sales Tax | No aplica | Servicios educativos digitales, no tangible goods |

---

## 2. Stack Financiero — Flujo del Dinero

### Procesadores de Pago

| Cuenta | Stripe ID prefix | Moneda | Qué cobra |
|--------|-----------------|--------|-----------|
| **Stripe US** | `acct_1TfzCJ...` | USD/EUR | Estudiantes del mercado LATAM y pagos internacionales |
| **Stripe DE** | `acct_1RPnaP...` | EUR | Estudiantes del mercado España/Europa (legacy, migración gradual a US) |

### Cuentas Bancarias

| Banco | Moneda | Uso |
|-------|--------|-----|
| **Mercury** (US) | USD | Cuenta operativa principal. Recibe payouts de Stripe US. Paga proveedores US (Vercel, Anthropic, etc.) |
| **Wise** | EUR/USD multi-currency | Recibe payouts de Stripe DE. Paga profesores (EUR). Transfers a Mercury si necesario |

### Flujo completo: Cobro → Disposición

```
Estudiante paga (tarjeta/SEPA)
        │
        ├─── Stripe US ──→ Payout automático → Mercury (USD)
        │                                         │
        │                                         ├─ SaaS (Vercel, Supabase, Anthropic, LiveKit)
        │                                         ├─ Google Ads (via tarjeta vinculada)
        │                                         └─ Transfer a Wise si falta EUR
        │
        └─── Stripe DE ──→ Payout automático → Wise (EUR)
                                                  │
                                                  ├─ Nómina profesores (transferencia EUR)
                                                  ├─ Proveedores EU
                                                  └─ Transfer a Mercury si falta USD
```

### Modelo de pricing (referencia)

- **Paquetes mensuales:** €249–€399/mes según intensidad
- **Paquetes one-time:** €690–€2,690 según duración
- **Trials:** Gratis (profesores no cobran por trials)
- **Comisión closer por conversión:** Variable por tipo

---

## 3. Cuentas y Accesos Críticos ("Llaves del Reino")

### Dominios

| Dominio | Registrador | Uso |
|---------|-------------|-----|
| `aprender-aleman.de` | (verificar — probablemente IONOS o Namecheap) | Dominio principal, landing, subdominios |

**Subdominios activos:**

| Subdominio | Hosting | Función |
|------------|---------|---------|
| `aprender-aleman.de` | Vercel | Landing page / funnel de captación |
| `b2c.aprender-aleman.de` | Vercel | Plataforma admin / panel estudiantes |
| `schule.aprender-aleman.de` | Vercel | Plataforma de ejercicios |
| `hans.aprender-aleman.de` | Vercel | Asistente IA Hans |
| `live.aprender-aleman.de` | Vercel | App real-time (clases en vivo) |
| `agents.aprender-aleman.de` | VPS (Hetzner/DO) | API de agentes WhatsApp + Python |
| `evolution.aprender-aleman.de` | VPS | Evolution API (WhatsApp gateway) |

### Infraestructura

| Servicio | Cuenta | Propósito |
|----------|--------|-----------|
| **Vercel** | aprenderaleman2026@gmail.com | Hosting web apps (Next.js) + crons |
| **Supabase** | `mtemnkmxajaluocfekbx` proyecto | PostgreSQL + Auth + Storage + Realtime |
| **VPS** (verificar proveedor) | — | Docker: Evolution API + Agents Python + LiveKit |
| **LiveKit Cloud** | `aprender-aleman-ep5y8x65` | WebRTC para clases en vivo |

### Servicios SaaS

| Servicio | Función | Factura a |
|----------|---------|-----------|
| **Anthropic** | Claude AI (agentes, Hans, automaciones) | Mercury/tarjeta |
| **Resend** | Email transaccional (info@aprender-aleman.de) | Mercury/tarjeta |
| **Evolution API** | WhatsApp Business gateway (self-hosted) | Solo VPS cost |
| **Calendly** | Booking de sesiones de prueba | Free/Pro plan |
| **Google Ads** | Campañas España (Customer ID: `380-055-0611`) | Tarjeta vinculada |

### Cuentas de Marketing

| Plataforma | ID/Referencia | Notas |
|------------|--------------|-------|
| **Google Ads** | Customer ID `380-055-0611` | Campaña "España" activa, "Alemania" pausada |
| **Meta Business / Facebook Ads** | Pixel ID `2233507904101190` | CAPI integrado con token |
| **Google Workspace** | aprenderaleman2026@gmail.com + gelfis@aprender-aleman.de | Email corporativo |

### Cuentas de acceso principal

| Sistema | Email/Usuario |
|---------|--------------|
| Google (Workspace + Ads + YouTube) | aprenderaleman2026@gmail.com |
| Stripe US + DE | (email registrado en cada cuenta) |
| Mercury | (email registrado) |
| Wise | (email registrado) |
| Vercel | aprenderaleman2026@gmail.com |
| Supabase | aprenderaleman2026@gmail.com |
| WhatsApp Business | +4915253409644 |
| WhatsApp personal (Gelfis) | +491607530948 |
| Calendly | aprenderaleman2026@gmail.com |

---

## 4. Contratos Vigentes

### Profesores (Freelance)

| Rol | Tipo contrato | Compensación | Moneda |
|-----|--------------|--------------|--------|
| Profesores nativos | Freelance agreement (Independent Contractor) | `rate_group_cents` + `rate_individual_cents` por clase | EUR |
| | | Trials: sin cobro (solo comisión por conversión) | |

**Términos estándar:**
- Pago mensual por horas facturadas (billed_hours × rate)
- Sin exclusividad
- Cancelación con 30 días de aviso
- Sin beneficios laborales (son contractors, no empleados)

### Closers (Ventas)

| Rol | Tipo contrato | Compensación |
|-----|--------------|--------------|
| Closers de venta | Freelance / comisión | Comisión por conversión de lead a estudiante pagante |

**Estructura:**
- Base: $0 (solo comisiones)
- Comisión por venta cerrada (variable según pack vendido)
- Panel propio en `/closer` para gestión de leads

### Proveedores Tecnológicos

| Proveedor | Servicio | Tipo | Facturación |
|-----------|----------|------|-------------|
| Vercel | Hosting + serverless | SaaS mensual | Tarjeta |
| Supabase | DB + Auth + Storage | SaaS mensual | Tarjeta |
| Anthropic | AI API | SaaS por uso | Tarjeta |
| VPS Provider | Servidor agentes | Mensual | Tarjeta |
| LiveKit | WebRTC infrastructure | SaaS por uso | Tarjeta |
| Resend | Email delivery | SaaS mensual | Tarjeta |
| Calendly | Scheduling | SaaS mensual | Tarjeta |
| Google Ads | Publicidad | Prepago/postpago | Tarjeta vinculada |
| Meta Ads | Publicidad | Postpago | Tarjeta vinculada |

---

## 5. Obligaciones Fiscales

### Estados Unidos (Wyoming LLC)

| Concepto | Detalle |
|----------|---------|
| Impuesto federal (Income Tax) | La LLC es "disregarded" → ingresos van al Schedule C del Form 1040 del miembro |
| Impuesto estatal Wyoming | **$0** — Wyoming no tiene income tax estatal |
| Self-Employment Tax | 15.3% sobre net earnings (Social Security + Medicare) |
| Estimated Tax Payments | Trimestrales (15 abr, 15 jun, 15 sep, 15 ene) si se debe >$1,000 |
| Annual Report Wyoming | $60/año — vencimiento en aniversario de formación |
| Sales Tax | No aplica a servicios educativos digitales |
| 1099 forms | Emitir 1099-NEC a contractors US que reciban >$600/año |

### Alemania (Post-Wegzug)

| Concepto | Detalle |
|----------|---------|
| Residencia fiscal | Terminada con el Wegzug (verificar fecha exacta de baja) |
| Declaración final (Einkommensteuererklärung) | Obligatoria para el año de salida (pro-rata) |
| Gewerbesteuer | Si había Gewerbe registrado, darlo de baja (Gewerbeabmeldung) |
| Wegzugsbesteuerung §6 AStG | Aplica si hay participaciones >1% en sociedades alemanas — no aplica a LLC US |
| Cuentas alemanas | Si se mantiene Wise u otras cuentas DE, no generan residencia fiscal |
| VAT / Umsatzsteuer | No aplica post-Wegzug si no hay establecimiento permanente en DE |
| Beschränkte Steuerpflicht | Solo si hay ingresos de fuente alemana (alquiler DE, empleo DE) — los clientes son españoles/LATAM, no de fuente DE |

### Consideraciones adicionales

- **España (clientes):** No genera obligación fiscal en España por ser servicios digitales B2C con sede fuera de la UE
- **FBAR/FATCA:** Obligatorio reportar cuentas Wise y cualquier cuenta no-US con >$10K agregado
- **Transfer Pricing:** No aplica (single entity, no hay estructura intercompany)
- **VAT EU (OSS):** Verificar si aplica One-Stop-Shop para ventas B2C digitales a la UE desde LLC US — threshold €10K

---

## Notas y Pendientes

- [ ] Confirmar registrador exacto del dominio aprender-aleman.de
- [ ] Verificar proveedor VPS (Hetzner vs DigitalOcean vs otro)
- [ ] Documentar emails exactos de registro en Stripe US, Stripe DE, Mercury, Wise
- [ ] Confirmar fecha exacta del Wegzug y si la declaración final DE está presentada
- [ ] Revisar si aplica EU OSS para ventas digitales B2C intra-UE
- [ ] Confirmar si hay Gewerbe registrado en Alemania pendiente de baja
