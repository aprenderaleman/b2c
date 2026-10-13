import { redirect } from "next/navigation";
// Ruta antigua: ahora todos usamos /chats (Gelfis 2026-10-13).
export default function Redir() { redirect("/profesor/chats"); }
