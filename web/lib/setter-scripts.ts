/**
 * Guiones de llamada del setter (textos de Gelfis 2026-11-25): cortos,
 * al grano, hablando de la ACADEMIA (Aprender-Aleman.de), no del profe.
 * Objetivo único de cada toque: el CONFIRMO de conexión.
 *
 * Se rellenan con los datos del lead y se muestran con el botón
 * "📋 Guion" en cada fila de /setter/urgentes. Para cambiar un texto:
 * editar aquí y push (deploy ~3 min).
 */

export type GuionTipo = "nuevo" | "recordatorio" | "refresh" | "rescate";

export type GuionVars = {
  nombre: string;       // primer nombre del lead
  dia: string;          // "hoy" | "mañana" | "lunes 25 nov"
  hora: string;         // "17:10"
};

const GUIONES: Record<GuionTipo, { titulo: string; texto: (v: GuionVars) => string }> = {
  nuevo: {
    titulo: "🔥 Acaba de agendar — confirmar la conexión",
    texto: (v) => `Hola ${v.nombre}, te habla Sheila de la academia Aprender-Aleman.de 😊

Solo para confirmarte tu clase de alemán de prueba el ${v.dia} a las ${v.hora} (hora de Alemania) — ya tenemos todo listo para ti.

¿Me confirmas que podrás conectarte?

[si confirma] ¡Súper! Cualquier duda me escribes por aquí.`,
  },
  recordatorio: {
    titulo: "📅 Clase inminente sin confirmar — conseguir el confirmo",
    texto: (v) => `Hola ${v.nombre}, te habla Sheila de la academia Aprender-Aleman.de.

Tenemos tu clase de alemán agendada para ${v.dia} a las ${v.hora} (hora de Alemania). ¿Me confirmas que te podrás conectar?

[si confirma] ¡Súper! Cualquier duda me escribes por aquí.`,
  },
  refresh: {
    titulo: "✅ Ya confirmó — toque corto, ¿todo ok?",
    texto: (v) => `Hola ${v.nombre}, te habla Sheila de la academia Aprender-Aleman.de 😊

Ya falta poco para tu clase de prueba (${v.dia} a las ${v.hora}). ¿Tienes alguna duda de cómo unirte? ¿Me confirmas que está todo ok?`,
  },
  rescate: {
    titulo: "🔄 No se conectó — rescatar sin culpar y reagendar",
    texto: (v) => `Hola ${v.nombre}, te habla Sheila de la academia Aprender-Aleman.de.

Tenías una clase de prueba agendada y noté que no te pudiste conectar — no te preocupes, puede pasar 😊

¿Aún mantienes el interés en aprender alemán?

[si dice SÍ] ¡Bien! Te envío el enlace para que puedas volver a agendar. Avísame si te surge cualquier duda.`,
  },
};

const REGLAS =
  "⚠️ No des información de más (precios, planes, niveles). Si preguntan: «Esa es una gran pregunta y entiendo por qué quieres saberlo — no te preocupes, tu profe te dará toda la información en la clase de prueba gratis. ¿Me confirmas si te podrás conectar?»";

export function buildGuion(tipo: GuionTipo, v: GuionVars): { titulo: string; texto: string; reglas: string } {
  const g = GUIONES[tipo];
  return { titulo: g.titulo, texto: g.texto(v), reglas: REGLAS };
}

/** Mensaje corto con el enlace del aula, para cuando el lead lo pide. */
export function buildEnlaceMsg(v: { nombre: string; fecha: string; enlace: string }): string {
  return `Hola ${v.nombre}, aquí tienes el enlace para unirte a tu clase de alemán el ${v.fecha}: ${v.enlace}`;
}
