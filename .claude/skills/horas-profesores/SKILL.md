---
name: horas-profesores
description: Audita las horas y clases facturables de los profesores del mes en curso, factura las que se dieron pero quedaron sin `billed_hours`, identifica casos en aclaración, y reporta cuánto pagar a cada profe. Usar cuando Gelfis pida "horas de los profesores", "nómina de este mes", "cuánto le pago a los profes", "horas pendientes" o similar.
---

# Horas de los profesores — auditoría + facturación + nómina

Cuando Gelfis pide "Horas de los profesores" o equivalente, ejecuta este flujo SIN preguntar más. Devuelve la tabla final + lista de aclaraciones + drafts de mensajes.

## Contrato de salida

El usuario espera, en este orden:

1. **Tabla de nómina** (1 fila por profe del mes en curso):
   - Profesor · Clases · Min · Importe (€) · Estado (`PAGADO` / `pendiente`)
2. **Lista de aclaraciones**: clases del mes con `billed_hours = 0` y sin evidencia técnica clara. El profe debe confirmar si las dió.
3. **Drafts de mensajes WhatsApp** para cada profe afectado por aclaraciones, listos para que Gelfis copie y pegue.
4. **Total pagable** del mes.

## Pasos a ejecutar (en orden)

### 1. Detectar mes en curso
Hoy en Berlín → primer día del mes. Ej: si hoy es 2026-05-19, el rango es `[2026-05-01, 2026-06-01)`.

### 2. Listar todas las clases `status='completed'` del mes con metadata forensic

Query (adaptar al mes):

```sql
SELECT c.id,
       to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','MM-DD HH24:MI') AS berlin,
       u.full_name AS profe, u.role,
       c.duration_minutes AS plan, c.actual_duration_minutes AS act,
       c.billed_hours, c.type, c.is_trial,
       LEFT(c.title, 35) AS title,
       (SELECT COUNT(*) FROM class_participants cp WHERE cp.class_id = c.id) AS n_parts,
       (SELECT COUNT(*) FILTER (WHERE attended=true) FROM class_participants cp WHERE cp.class_id = c.id) AS n_attended,
       c.livekit_room_id IS NOT NULL AS had_room,
       (SELECT COUNT(*) FROM recordings r WHERE r.class_id = c.id AND r.status='ready') AS recs,
       to_char(c.started_at AT TIME ZONE 'Europe/Berlin','HH24:MI') AS started,
       to_char(c.ended_at   AT TIME ZONE 'Europe/Berlin','HH24:MI') AS ended,
       CASE WHEN c.started_at IS NOT NULL AND c.ended_at IS NOT NULL
            THEN ROUND(EXTRACT(EPOCH FROM (c.ended_at - c.started_at))/60)::int
       END AS real_min,
       EXISTS (SELECT 1 FROM class_hours_log chl WHERE chl.class_id = c.id) AS has_log
  FROM classes c
  JOIN teachers t ON t.id=c.teacher_id
  JOIN users u   ON u.id=t.user_id
 WHERE c.status='completed'
   AND c.scheduled_at >= date_trunc('month', NOW())
   AND c.scheduled_at <  date_trunc('month', NOW()) + INTERVAL '1 month'
   AND u.role = 'teacher'
 ORDER BY c.scheduled_at;
```

### 3. Clasificar cada clase con la regla forense

Por cada clase con `billed_hours = 0`:

- **DIO clase** (auto-factura) si:
  - `recs >= 1` (hay grabación lista) — evidencia máxima, OR
  - `real_min >= 50% del plan` (timer started/ended_at activado), OR
  - `act >= 50% del plan` (actual_duration_minutes registrado).

- **NO DIO** (dejar bh=0) si:
  - `act IS NOT NULL AND act < 15` (alguien entró pero no hubo clase, ej. 1 min)

- **INCIERTO** (pedir aclaración al profe) si:
  - Sin recording, sin started/ended_at, sin actual_duration → no podemos saber.

Para las que SÍ se dieron, calcular `billed_hours` aplicando la regla universal 50min = 1u:

| Duración real | Unidades |
|---|---|
| `< 15 min` | 0 (no facturar) |
| `15-75 min` | 1 |
| `76-125 min` | 2 |
| `126-175 min` | 3 |
| `>= 176 min` | `ceil(min / 50)` |

### 4. Facturar las clases identificadas como "se dió"

UPDATE clases con `billed_hours` calculado y `actual_duration_minutes` (usar `real_min` si existe, sino `plan`). El trigger `tg_classes_auto_log_hours` (migration 047) inserta automáticamente en `class_hours_log` y recompute `teacher_earnings`.

```sql
UPDATE classes SET billed_hours = $units, actual_duration_minutes = $actMin
 WHERE id = $classId;
```

### 5. Detectar profes con `rate_*_cents = 0` o rate desincronizado

Algunos profes auto-registrados pueden tener tarifas en `hourly_rate_*` (€ NUMERIC) pero NO en `rate_*_cents` (céntimos INTEGER). En ese caso reportar como **incidencia previa al pago**:

```sql
SELECT t.id, u.full_name, t.hourly_rate_individual, t.rate_individual_cents,
       t.hourly_rate_group, t.rate_group_cents
  FROM teachers t JOIN users u ON u.id=t.user_id
 WHERE t.active = TRUE
   AND ((t.hourly_rate_individual IS NOT NULL AND COALESCE(t.rate_individual_cents,0)=0)
     OR (t.hourly_rate_group      IS NOT NULL AND COALESCE(t.rate_group_cents,0)=0));
```

Si hay match, NO autorizar el pago de ese profe hasta que admin revise. Recomendar al usuario revisar `/admin/profesores/[id]`.

### 6. Generar la tabla de nómina

```sql
SELECT u.full_name, te.classes_count, te.total_minutes,
       te.amount_cents/100.0 AS eur, te.paid
  FROM teacher_earnings te
  JOIN teachers t ON t.id=te.teacher_id
  JOIN users u   ON u.id=t.user_id
 WHERE te.month = date_trunc('month', NOW())::date
 ORDER BY te.amount_cents DESC;
```

### 7. Generar drafts de WhatsApp para los profes con aclaraciones pendientes

Para cada profe que tenga clases en estado **INCIERTO**, escribir un mensaje breve listando esas clases con fecha+hora+alumno y pidiéndole confirmación. Estilo:

> Hola [Nombre]! 👋
>
> Estoy cerrando la nómina del mes y tengo estas clases sin facturar
> por no estar seguro si se dieron:
>
>   • MM-DD HH:MM · [alumno/grupo]
>   • ...
>
> ¿Me confirmas cuáles se dieron y de cuánto fueron? Las facturo y
> sumo a tu pago.
>
> — Gelfis

### 8. (Opcional, si Gelfis pide comparar) Mensaje de cross-check

Si Gelfis pidió "preguntar al profesor cuántas horas tiene hasta ahora", añadir un draft adicional con la cuenta del SISTEMA para que el profe pueda contrastar con lo suyo:

> Hola [Nombre]! Cierre del mes.
>
> Mi sistema te factura:
>   • Individuales: X clases (Y horas)
>   • Grupales:     A clases (B horas)
>   • Total: Z €
>
> ¿Cuadra con tus números o me falta algo?

## Reglas operativas

- **NO** facturar trials de Stiv (las da el admin Gelfis vía `is_trial=true` + Gelfis user). Las clases con `u.role != 'teacher'` se excluyen del payroll directamente desde la query.
- **NO** auto-facturar nada que tenga `act < 15` con `act IS NOT NULL` — fueron entradas accidentales.
- Cuando facturas vía UPDATE, el trigger ya rollupea `teacher_earnings` — no llames `recompute_teacher_month` manualmente.
- Si encuentras profe con `rate_*_cents = 0` pero `hourly_rate_*` no nulo, hacer backfill (UPDATE … SET rate_*_cents = hourly_rate_* * 100).

## Cómo correr las queries

Usa el patrón de los scripts en `scripts/`:

```bash
node -e "
import('node:fs').then(async (fs) => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const pg = require('pg');
  const env = {};
  for (const l of fs.readFileSync('C:/Users/gelfi/Desktop/b2c/.env','utf8').split(/\r?\n/)) {
    const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(!m) continue;
    let v=m[2]; if((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith(\"'\")&&v.endsWith(\"'\"))) v=v.slice(1,-1);
    env[m[1]]=v;
  }
  const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  // ... queries aquí ...
  await c.end();
}).catch(e=>{console.error('ERR:',e.message);process.exit(1)});
" --input-type=module
```

## Formato del reporte final que devuelves al usuario

```
# 💰 Nómina [mes] [año]

| Profesor | Clases | Min | A pagar | Estado |
|---|---|---|---|---|
| [name] | N | M | XX,XX € | PAGADO/pendiente |
| ... | ... | ... | ... | ... |
| **TOTAL** | … | … | **XXX,XX €** | |

## ⚠ Clases en aclaración

(Si las hay; si no: "Sin incidencias — todo facturado.")

- [profe] · MM-DD HH:MM · [alumno] · plan=X min · sin evidencia (no rec, no timer)

## 📩 Drafts para los profes (envíalos tú)

### Para [Profe]
\`\`\`
[mensaje]
\`\`\`

(Repetir por cada profe con incidencias.)
```

Si todo cuadra y no hay aclaraciones, omite las secciones ⚠ y 📩 y solo entrega la tabla + total.
