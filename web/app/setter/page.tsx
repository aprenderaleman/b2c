import { redirect } from "next/navigation";

/**
 * "Mi cola" se consolidó en /setter/urgentes (Gelfis 2026-11-24): el
 * marcador, el aviso de IBAN y la pestaña "No asistieron" viven allí
 * junto a Calientes / Hoy / Mañana. La ruta queda como redirección para
 * marcadores y enlaces viejos.
 */
export default function SetterHomePage() {
  redirect("/setter/urgentes");
}
