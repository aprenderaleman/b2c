# Runbook — número WhatsApp baneado (playbook v5)

Uso: cuando WhatsApp bloquea el número actual (v4 = `+49 152 5340 9644`). Historial: v1, v2, v3 baneados en 6 meses. Objetivo: nuevo número operativo en <2h sin depender de memoria.

## Configs relevantes en `system_config`

Todas editables por SQL — el wrapper (TS y Python) las lee con cache 60s.

| Key | Default | Descripción |
|---|---|---|
| `whatsapp_disabled` | `off` | `off` / `partial` / `full`. Kill switch global. `partial` = solo kinds whitelist. |
| `active_whatsapp_instance` | `aprender-aleman-v4` | Instancia Evolution activa. |
| `active_whatsapp_number` | `+4915253409644` | Número del canal principal. |
| `wa_daily_send_cap` | `300` | Máximo mensajes WA/día. Cap normal (no warm-up). |
| `wa_night_gate_enabled` | `true` | Si `true`, silencia mensajes 22:00–08:00 Berlin salvo T-30m/T-15m. |
| `wa_burst_cap_per_tick` | `20` | Máximo mensajes por ejecución de cron. Los crons hacen LIMIT en su query. |
| `wa_warmup_day` | `''` | Día 1–14 del warm-up post-ban. `''` = sin warm-up. Cap efectivo: 30/día días 1-3, 100/día días 4-7. |
| `wa_warmup_started_at` | `''` | Timestamp de inicio del warm-up. Solo referencia. |

## Detección de ban

- Banner rojo en `/admin` "Evolution CLOSE".
- Cron `webhook-self-heal` reporta `connectionState !== 'open'` durante >30 min.
- Lead responde "el número no existe" o similar.
- Múltiples `send_failed` con `http_400: Number does not exist`.

## Playbook (v5)

### Paso 1 — Corte inmediato (<2 min)

```sql
UPDATE system_config SET value='full' WHERE key='whatsapp_disabled';
```

Corta todo WA. Los crons siguen corriendo pero no envían nada.

### Paso 2 — Aviso a leads con trial en <24h (5 min)

```sql
SELECT l.id, l.name, l.email, c.scheduled_at
  FROM classes c JOIN leads l ON l.id = c.lead_id
 WHERE c.is_trial AND c.status = 'scheduled'
   AND c.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours';
```

Manual: email a cada uno con el nuevo número (ver Paso 6) o llamada.

### Paso 3 — SIM nueva (<30 min)

- Comprar SIM alemana Aldi / Vodafone prepago (~5 €). No usar SIM de otro país (WhatsApp lo detecta como abuso).
- Activar en móvil físico.
- Anotar número E.164.

### Paso 4 — Crear instancia Evolution v5 (<15 min)

```bash
# En VPS Hetzner (SSH)
docker exec evolution_api curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"aprender-aleman-v5","token":"","integration":"WHATSAPP-BAILEYS"}'
```

### Paso 5 — Vincular QR (<5 min)

```bash
docker exec evolution_api curl -X GET http://localhost:8080/instance/connect/aprender-aleman-v5 \
  -H "apikey: $EVOLUTION_API_KEY"
```

Copiar `qrcode.base64` de la respuesta → decodificar → mostrar en pantalla → escanear desde el móvil con la SIM nueva. WhatsApp → Ajustes → Dispositivos vinculados.

### Paso 6 — Switch atómico + warm-up (<3 min)

```sql
UPDATE system_config SET value = 'aprender-aleman-v5' WHERE key = 'active_whatsapp_instance';
UPDATE system_config SET value = '+49XXXXXXXXXX'      WHERE key = 'active_whatsapp_number';
UPDATE system_config SET value = '1'                  WHERE key = 'wa_warmup_day';
UPDATE system_config SET value = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ') WHERE key = 'wa_warmup_started_at';
UPDATE system_config SET value = 'off'                WHERE key = 'whatsapp_disabled';
```

Efectos inmediatos:
- Todos los envíos van al número v5.
- Cap diario efectivo = 30/día durante 3 días (warm-up).
- Cron `warmup-day-advance` (opcional, si existe) o manual: subir `wa_warmup_day` cada día.

### Paso 7 — Actualizar firmas (<10 min)

Cambiar el número en las siguientes rutas:

- `agents/agent_1_writer.py` — constantes `SIGN_OFF_ES` / `SIGN_OFF_DE`
- `web/lib/email/templates/*.ts` — cualquier `wa.me/49...` o `web.whatsapp.com/send?phone=49...`
- Landing `web/app/(marketing)/*` — botones flotantes
- `web/lib/whatsapp.ts` — `HARDCODED_BLOCKLIST` (asegurar que Gelfis personal sigue en la lista, número nuevo NO)

Commit + push. Deploy Vercel tarda ~3 min.

### Paso 8 — Warm-up avance manual

| Día | Cap efectivo | Acción |
|---|---|---|
| 1–3 | 30/día | Solo transaccionales (trial confirmations, reminders). Sin comunicados. |
| 4–7 | 100/día | Añadir welcome_student y post_trial. Sin comunicados masivos. |
| 8–14 | `wa_daily_send_cap` normal (300) | Comunicados con moderación. |
| 15+ | Sin warm-up | `UPDATE system_config SET value='' WHERE key='wa_warmup_day';` |

Comando diario:

```sql
UPDATE system_config SET value = (value::int + 1)::text WHERE key = 'wa_warmup_day';
```

## Contingencia si el playbook falla

- **SIM no llega QR:** WhatsApp bloquea la vinculación → cambiar de SIM (probar otra operadora).
- **v5 baneado en <7 días:** revisar patrón — puede ser el copy (regex tipo spam), volumen fuera de warm-up, o llamada duplicada desde múltiples IPs. Auditar `lead_timeline` de las 48h previas al ban.
- **Meta Cloud API disponible:** migrar (ver `docs/meta-cloud-migration.md` cuando exista).

## Verificación post-deploy

Después de un playbook v5 completado, monitorear 48h:

```sql
-- Ningún envío nocturno no-exento
SELECT COUNT(*), metadata->>'kind' AS kind
  FROM lead_timeline
 WHERE type = 'system_message_sent'
   AND metadata->>'channel' = 'whatsapp'
   AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/Berlin') NOT BETWEEN 8 AND 21
   AND metadata->>'kind' NOT IN ('trial_reminder_30m','trial_reminder_15m')
   AND timestamp > NOW() - INTERVAL '48 hours'
 GROUP BY 2;

-- Ninguna ráfaga >20/tick
SELECT date_trunc('minute', timestamp) AS minute, COUNT(*)
  FROM lead_timeline
 WHERE type = 'system_message_sent'
   AND metadata->>'channel' = 'whatsapp'
   AND timestamp > NOW() - INTERVAL '48 hours'
 GROUP BY 1
HAVING COUNT(*) > 20
 ORDER BY 2 DESC;
```

Ambas queries deben devolver `0 rows` si las protecciones funcionan.
