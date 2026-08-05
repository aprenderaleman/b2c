# Auditoría de acciones del CRM closer — `/closer/leads/[id]`

> Auditado sobre el código real el 2026-08-05. Fuentes:
> `web/lib/closer-action-flow.ts`, `web/lib/closer-layer2-actions.ts`,
> `web/lib/chain-definitions.ts`, `db/migrations/099_closer_chain8_templates.sql`,
> `web/app/api/closer/leads/[id]/*`.

## Cómo se envían los mensajes

Cada acción con mensajes arranca una **cadena**: una secuencia de WhatsApps que
Stiv envía solo. El cron `chain-processor` corre **cada 10 minutos** y dispara
los pasos vencidos (un mensaje sale como máximo 10 min después de su hora).
Los tiempos (T+…) cuentan **desde el clic del closer**. Las plantillas viven en
`message_templates` y se editan en `/admin/mensajes`; las variables
(`{nombre}`, `{profe}`, `{meta}`, `{ritmo}`…) se rellenan con datos del lead.

**Reglas globales:**

| Regla | Efecto |
|---|---|
| Una cadena activa por lead | Arrancar una nueva cancela la anterior |
| El lead responde | La cadena se pausa 24h |
| El lead paga | La cadena se cancela |
| El closer registra cualquier resultado | La cadena activa se cancela (R2: "humano mata automático") |

---

## Botón [Registrar] (capa 1 — resultados)

Único camino para completar tareas y mover estados. Endpoint:
`/api/closer/tasks/[id]/complete` (con tarea) o `/api/closer/leads/[id]/registrar`
(sin tarea). Ambos ejecutan `processActionResult()`:

1. Completa la tarea (si hay) con fecha y resultado.
2. Registra la acción en `acciones_closer` (chips/motivos incluidos) —
   esto actualiza la "última atención" que usa el semáforo.
3. Escribe en el timeline del lead.
4. Si el lead estaba `seguimiento_pactado` → vuelve a `activo`.
5. Cancela la cadena automática activa (R2).
6. Deriva estado si aplica (ver tabla).

| Resultado | Extras | Efecto en el lead |
|---|---|---|
| Contactado | Chip de objeción opcional (Precio / Pensarlo / Pareja / Tiempo / Otra) | El chip solo se guarda como dato — **no dispara cadena de objeción** (esas solo las usa el flujo profe/admin) |
| No contestó | — | Solo registro |
| Buzón | — | Solo registro |
| Reagendó | — | Solo registro |
| VENTA | Abre el modal de venta | Ver "Marcar venta" |
| No interesado | Motivo obligatorio (Se enfrió / Sin dinero / Eligió otra / Otro) | **Cancela todas las tareas pendientes + cadena → lead `perdido`** con `motivo_perdido`. Única forma de perder un lead |

Tras un resultado no terminal, el modal pasa a **capa 2: "¿Siguiente jugada?"**
con las acciones de abajo embebidas.

---

## Acciones (capa 2 / Layer2)

### 📅 Agendar — cadena 8A
- Registra "Agendó nueva clase" (resultado `reagendado`).
- **T+24h** — WA: *"¡Hola {nombre}! 😊 Solo confirmando: tu clase con {profe}
  sigue en pie. ¿Todo bien para asistir? Cualquier cambio me dices y lo
  reagendamos al instante 👉 {link_agenda}"*
- Al dispararse crea **tarea al closer**: "Confirmar asistencia a clase
  agendada" (para 24h después, prioridad media).

### 📵 No contestó — cadena 8B (3 mensajes)
Muestra el paso 1 copiable para envío manual. Programa:
- **T+4h** — WA: *"¡{nombre}! Intenté llamarte hace un rato 📞 ¿Te va mejor que
  hablemos por aquí? Quería contarte las opciones para arrancar con tu {meta} 💪"*
- **T+24h** — WA: *"¡Hola {nombre}! 😊 Sigo pendiente de ayudarte con tu alemán.
  {profe} me comentó que la clase fue genial — solo falta elegir tu plan y
  empezar. ¿Te llamo hoy o prefieres que te mande la info por aquí?"*
  + **tarea al closer** "Segundo intento de contacto" (inmediata, vence en 8h).
- **T+3 días** — WA cierre suave: *"Última de mi parte, {nombre} 😊 Tu
  diagnóstico y tu plaza quedan guardados. Cuando el momento sea el correcto,
  me escribes y retomamos donde lo dejamos. ¡Éxitos! 🍀"*
  → al completarse el lead pasa a **`en_reactivacion`**.

### 📋 Enviar info — cadena 8C
- Registra "Info de cursos enviada" (mensaje copiable).
- **T+24h** — WA: *"¡{nombre}! ¿Pudiste revisar la info que te mandé? 😊 Si
  tienes alguna duda sobre los ritmos o los precios, aquí estoy para resolverla.
  Recuerda que puedes ver todo en detalle aquí 👉 {link_inscripciones}"*
  + **tarea al closer** "Seguimiento tras envío de info" (24h después).

### 💰 Propuesta — cadena 8D (3 mensajes)
El closer elige ritmo (Viajero 240€ / Estándar 320€ / Intensivo 450€ /
VIP Express 690€); ritmo y precio se inyectan:
- **T+24h** — WA: *"¡{nombre}! ¿Qué te pareció la propuesta del {ritmo}? 😊 Con
  ese ritmo tu {meta} llega en {fecha_llegada}. ¿Tienes alguna pregunta? Aquí
  estoy para resolverla 💪"* + **tarea al closer** "Seguimiento propuesta
  enviada" (inmediata, vence en 8h, prioridad **alta**).
- **T+3 días** — WA: *"¡Hola {nombre}! Solo un recordatorio: la propuesta del
  {ritmo} ({precio_ritmo}) sigue disponible. Si prefieres otro ritmo o tienes
  dudas, dime y lo ajustamos a lo que mejor te funcione 😊"*
- **T+5 días** — WA cierre suave: *"Te dejo tranquilo/a, {nombre} 😊 Tu
  propuesta queda guardada y las puertas abiertas. Cuando el momento sea el
  correcto, me escribes y empezamos de inmediato. ¡Éxitos con tu alemán! 🍀"*
  → lead pasa a **`en_reactivacion`**.

### 📆 Seguimiento (con fecha) — sin mensajes
- **No envía nada automático.** Al contrario: **cancela la cadena activa**
  (el humano tomó el control).
- Crea una tarea de llamada para la fecha elegida.
- Estado derivado: lead → **`seguimiento_pactado`** (se libera a `activo` al
  registrar el resultado de esa llamada).
- Existe plantilla 8E de confirmación (*"¡Perfecto {nombre}! Queda
  agendado…"*) pero hoy no se dispara — disponible como copiable.

### 🔗 Enlace — sin cadena propia
- Abre el flujo de venta / enlace de inscripción (Stripe Checkout vía
  `send-offer`). Al enviarse el enlace arranca la cadena `chain2_link_sent`
  (seguimiento de pago) y se registra la oferta en `ofertas_enviadas`.
- Si pasan **3h sin pagar**, el semáforo pone el lead 🔴 "Enlace sin pagar".

### ✅ Confirmar pago — sin mensajes
- Verificación manual dentro del flujo de ventas existente.

### 🌙 Reactivación — cadena 8G (2 mensajes)
- Lead pasa a **`en_reactivacion`** de inmediato.
- **T+0** (siguiente pasada del cron, ≤10 min) — WA: *"¡Hola {nombre}! 😊 Ha
  pasado un tiempo desde que hablamos de tu alemán. ¿Sigues con ganas de lograr
  tu {meta}? Tenemos nuevas opciones y horarios — dime si quieres que te cuente
  las novedades 💪"*
- **T+4 días** — WA: *"Última de mi parte, {nombre} 😊 Tu diagnóstico sigue
  guardado y tu plaza disponible. Cuando quieras retomar, un mensaje y
  arrancamos. ¡Éxitos! 🍀"* → fin de cadena.

---

## Marcar venta

`MarkSaleModal` → `/api/closer/leads/[id]/mark-sale`:
- Crea fila en `ventas` (pack + tipo de pago + monto) en estado `pendiente`
  y notifica al admin en `/admin/aprobaciones`.
- **El estado del lead NO cambia** (sigue `activo`) — la venta pendiente vive
  en la tabla `ventas`; a las 3h sin pago el semáforo la marca 🔴.
- Al **aprobar** la venta (pago confirmado) → lead `convertido` y sus notas
  migran al perfil de estudiante. Al **rechazar** → vuelve a `activo`.

## Estados derivados (nunca editables a mano)

| Estado | Lo dispara |
|---|---|
| `activo` | Asignación de closer · rechazo de venta · registrar resultado estando pactado |
| `seguimiento_pactado` | Acción 📅 Seguimiento con fecha |
| `convertido` | Aprobación de la venta (post-pago) |
| `en_reactivacion` | Acción 🌙 · cierre suave de cadenas 8B/8D sin respuesta |
| `perdido` | Registrar "No interesado" + motivo |
