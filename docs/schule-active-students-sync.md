# Sync de estudiantes activos b2c → SCHULE

**Última actualización:** 2026-04-30

## Por qué este documento existe

SCHULE (la academia de práctica online) necesita saber qué estudiantes
de Aprender-Aleman.de tienen una suscripción activa para concederles
acceso al material. La fuente de verdad es la BD de b2c (la tabla
`students`). En lugar de darle a SCHULE acceso directo a Postgres
— acoplaríamos esquemas y abriríamos riesgos de seguridad — b2c
expone dos endpoints HTTP server-to-server. SCHULE los consulta con
una API key compartida.

## Contrato

Ambos endpoints son `nodejs` runtime, `force-dynamic`, devuelven
JSON, autenticados con la cabecera **`X-Internal-Api-Key`** cuyo
valor coincide con `B2C_INTERNAL_API_KEY` en el `.env` de Vercel
(b2c). No confundir con `B2C_SYNC_SECRET` (que es para el flujo
SSO inverso b2c → SCHULE — son secretos diferentes y se rotan
independientemente).

### 1. Bulk · *recomendado para un cron diario en SCHULE*

```
GET https://b2c.aprender-aleman.de/api/internal/students/active
Header: X-Internal-Api-Key: <B2C_INTERNAL_API_KEY>
```

**Respuesta 200**:
```json
{
  "ok": true,
  "generated_at": "2026-04-30T16:42:11.123Z",
  "count": 13,
  "students": [
    {
      "user_id":             "uuid",
      "email":               "ayman.kayali.lucena@gmail.com",
      "full_name":           "Ayman Kayali",
      "subscription_status": "active",       // active | paused
      "pack_expires_at":     "2026-12-31T00:00:00Z",  // o null
      "current_level":       "B1",           // o null
      "language_preference": "es"            // es | de
    }
  ]
}
```

Filtro aplicado en b2c:
* `subscription_status IN ('active', 'paused')`
* `users.active = true` (no soft-deleted)
* `pack_expires_at IS NULL OR pack_expires_at > NOW()`

`paused` se incluye porque SCHULE debería mantener acceso al material
mientras la facturación esté pausada (vacaciones, congelaciones).

### 2. Lookup individual · *recomendado para verificar al login*

Endpoint preexistente, reusado:

```
GET https://b2c.aprender-aleman.de/api/internal/student/verify?email=foo@bar.com
Header: X-Internal-Api-Key: <B2C_INTERNAL_API_KEY>
```

**Respuesta 200**:
```json
{ "success": true, "data": { "isActiveStudent": true } }
```

`isActiveStudent` es `true` solo si `users.active && subscription IN
('active','paused') && pack no expirado`. Mismo criterio que el
bulk — la única diferencia es que aquí el booleano viene precocinado.

## Cómo lo consume SCHULE — patrón sugerido

```python
# Cron diario en SCHULE — ej. 03:00 Berlin.
import httpx, os
B2C_BASE = os.environ["B2C_API_BASE"]            # https://b2c.aprender-aleman.de
KEY      = os.environ["B2C_INTERNAL_API_KEY"]    # mismo string que en b2c

resp = httpx.get(
    f"{B2C_BASE}/api/internal/students/active",
    headers={"X-Internal-Api-Key": KEY},
    timeout=30,
)
resp.raise_for_status()
payload = resp.json()
# Reconcile contra la tabla de SCHULE: añade nuevos, marca inactivos
# los que ya no aparecen, conserva el resto.
```

Para el flujo on-demand (por ejemplo, validar al login de un alumno
en SCHULE), usa el endpoint de lookup individual antes de mostrarle
el dashboard. Cachea el resultado N minutos en SCHULE para no
hammer-pollar el endpoint en cada navegación.

## Reglas de evolución

* **Añadir campos** al payload está permitido sin romper.
* **Renombrar / eliminar campos** existentes: bumpea el path
  (`/api/internal/students/v2/active`). Mantén la v1 por dos
  semanas mientras SCHULE migra.
* **Cambiar el filtro lógico** (qué se considera activo): coordina
  con SCHULE primero o vas a sorprenderles con bajas/altas masivas
  el día siguiente.

## Rotación de la API key

Cuando rotes `B2C_INTERNAL_API_KEY`:

1. Genera el nuevo valor (`openssl rand -hex 32`).
2. Pásalo a SCHULE primero. Que lo despliegue en su `.env`.
3. En b2c (Vercel env), guarda el nuevo Y MANTÉN el viejo en una var
   `B2C_INTERNAL_API_KEY_PREVIOUS` durante 24h. Modifica los dos
   endpoints para aceptar cualquiera de los dos durante la ventana.
4. Tras 24h, borra `B2C_INTERNAL_API_KEY_PREVIOUS` y queda solo el
   nuevo activo.

(El skeleton para esa rotación dual no está implementado todavía —
hoy es una sola key. Cuando vayas a rotar, dímelo y lo monto.)
