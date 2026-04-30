/**
 * Single-line toggle para el estado de mantenimiento de SCHULE.
 *
 * Cuando `SCHULE_MAINTENANCE` está en true:
 *   - Las dos cards "Abrir SCHULE" en /estudiante y /profesor se
 *     vuelven no-clicables y muestran un mensaje "App en mantenimiento".
 *   - El SSO endpoint /api/entitlements/schule-open devuelve una
 *     página de mantenimiento en HTML en lugar de redirigir.
 *   - El onDisconnected del aula manda al estudiante a /estudiante
 *     en vez de a SCHULE.
 *   - ClosedScreen del aula y la sección de /confirmacion remplazan
 *     el botón "Empezar ahora con SCHULE" por un aviso.
 *
 * Para reactivar SCHULE: cambia esta línea a `false` y haz commit.
 * Vercel rebuild ~2 min y todo vuelve.
 */
export const SCHULE_MAINTENANCE = true;

export const SCHULE_MAINTENANCE_TITLE_ES   = "SCHULE en mantenimiento";
export const SCHULE_MAINTENANCE_BODY_ES    =
  "Estamos arreglando un problema. Volverá a estar disponible en cuanto lo resolvamos.";

export const SCHULE_MAINTENANCE_TITLE_DE   = "SCHULE in Wartung";
export const SCHULE_MAINTENANCE_BODY_DE    =
  "Wir beheben gerade ein Problem. Es ist wieder verfügbar, sobald wir es gelöst haben.";
