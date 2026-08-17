import { redirect } from "next/navigation";

/**
 * /closer — la vista HOY (cola separada) se eliminó (decisión Gelfis
 * 2026-08-17): "Mis leads" ES la cola — ordenada por semáforo
 * (rojo → amarillo → verde) con el último contacto visible.
 */
export default function CloserHomePage() {
  redirect("/closer/leads");
}
