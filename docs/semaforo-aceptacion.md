# Semáforo global — prueba de aceptación (10 checks)

Spec: "Sistema de estados globales con semáforo + registro universal de
contactos" (Gelfis, 2026-08-16). Estado a fecha 2026-08-17.

| # | Check | Cómo está verificado |
|---|-------|----------------------|
| 1 | Lead nuevo sin toque → rojo 🆕 a los 31 min hábiles | Unit `semaforo.test.ts` › "R4 — lead nuevo": 29min→no rojo, 31min→R4 🆕 |
| 2 | Stiv envía inicio de cadena → verde | Unit: "un envío de Stiv apaga R4" + "cadena activa → verde V1" |
| 3 | Lead responde → rojo 💬 a las 2h01 si nadie atiende | Unit "C5 — reloj nocturno (R1)": mensaje 23:30 → 09:59 no rojo, 10:01 rojo R1 (ventana hábil 08–22 Berlín) |
| 4 | Closer registra acción → verde con auto-tarea +3d visible | Integración `semaforo.integration.test.ts` contra BD real: `ensureFuturePlay` crea tarea `auto_seguimiento` a ~+3d y no duplica. Enganchado en `processActionResult` y en `/api/contacts/register` |
| 5 | Profe no registra feedback tras trial → rojo 🎓 a las 2h01 | Unit "Check 5": 1h59→null, 2h01→🎓; asistencia registrada lo apaga; pre-epoch no retroactivo |
| 6 | Enlace de pago → amarillo; a las 3h01 sin pago → rojo 💰 | Unit "R3 / A3": <3h→A3 amarillo, 3h01→R3 💰; saliente posterior o pago lo apagan |
| 7 | Pago por webhook → 💰 verde convertido, sin intervención | Unit "convertido → verde 💰 V2" + E2E fase 1 (12/12): el espejo de `conversion` registra `confirmar_pago`/`webhook_pago` |
| 8 | nota_libre con 3 caracteres → rechazado | Unit "Check 8": `nota_corta`; además `occurred_at` >48h atrás o futuro → `occurred_at_invalido` |
| 9 | Acción que deja al lead sin jugada → auto-tarea +3d creada | Misma integración del check 4 (constraint del flujo de guardado, no sugerencia) |
| 10 | semaforo-trace explica el color con registros concretos | Verificado en producción: `GET /api/internal/lead/:id/semaforo-trace` del lead de prueba devolvió 🔴 R2 "📅 Vencida 2d" con la tarea exacta como evidencia |

## Checklist de confiabilidad (sección 5)

- **C1 idempotencia**: dedupe por `timeline_id` / `legacy_accion_id` / `event_id` únicos (E2E fase 1).
- **C2 timestamps**: todo en UTC en BD, render Berlín; comparaciones numéricas (no lexicográficas).
- **C3 envíos**: el contacto se registra solo si la API de Evolution acepta el envío; fallo → `send_failed` sin contacto. Receipt de entrega real: pendiente (mejora acordada post-fase-1).
- **C4 sin estados fantasma**: endpoint de trace en producción; cada color lleva regla + evidencias.
- **C5 reloj nocturno**: unit test dedicado (23:30 → rojo a las 10:01 del día siguiente).
- **C6 arranque en verde**: epoch `2026-08-17 00:00 Berlín` en código (R1/R3/R4/R5 ignoran disparadores previos) + migración 117 (archiva tareas vencidas históricas con marca `[C6]` y crea auto-tarea +3d a los activos sin jugada).

## Qué NO se construyó (sección 6, respetado)

Sin editor de colores, sin snooze, sin scoring/IA, sin push por rojo,
sin edición/borrado de contactos (trigger de inmutabilidad; solo las
cascadas GDPR del sistema pasan), y el cron observador nunca actúa
sobre leads.
