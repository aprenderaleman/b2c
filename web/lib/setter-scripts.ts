/**
 * Guiones de llamada del setter (Gelfis 2026-11-24), estilo Hormozi:
 * velocidad, personalización, compromiso explícito y aversión a la
 * pérdida. SIN vender y SIN precios — eso es del profe/closer.
 *
 * Se rellenan con los datos del lead y se muestran con el botón
 * "📋 Guion" en cada fila de /setter/urgentes. Para cambiar un texto:
 * editar aquí y push (deploy ~3 min).
 */

export type GuionTipo = "nuevo" | "recordatorio" | "refresh" | "rescate";

export type GuionVars = {
  nombre: string;       // primer nombre del lead
  profe: string;        // primer nombre del anfitrión
  dia: string;          // "lunes 25 nov" | "hoy" | "mañana"
  hora: string;         // "17:10"
};

const GUIONES: Record<GuionTipo, { titulo: string; texto: (v: GuionVars) => string }> = {
  nuevo: {
    titulo: "🔥 Acaba de agendar — llamar YA (los primeros 5 min valen oro)",
    texto: (v) => `¡${v.nombre}! Soy Sheila, del equipo del profesor ${v.profe} en Aprender Alemán.

Te llamo ya mismo porque acabo de ver entrar tu reserva — así de en serio nos tomamos tu clase 😄. Quedó para el ${v.dia} a las ${v.hora} (hora de Alemania).

${v.profe} prepara cada clase según el objetivo del estudiante, así que cuéntame una cosa: ¿para qué quieres el alemán — trabajo, mudanza, familia?

[escuchar y anotar — esto va en la nota del lead]

Perfecto, se lo paso a ${v.profe} para que tu clase sea 100 % sobre eso.

Último favor: guarda la cita en tu calendario ahora que estamos hablando. Ese horario queda bloqueado solo para ti — ${v.profe} te va a estar esperando.`,
  },
  recordatorio: {
    titulo: "📅 Clase inminente sin confirmar — conseguir el COMPROMISO",
    texto: (v) => `${v.nombre}, soy Sheila de Aprender Alemán.

${v.profe} ya tiene lista tu clase de ${v.dia} a las ${v.hora} (hora de Alemania): preparó el material para tu nivel, o sea que esto ya está en marcha 💪.

Solo me falta tu palabra: ¿cuento contigo a las ${v.hora}?

[esperar el SÍ — un "creo que sí" no es un sí: "¿lo apunto como seguro entonces?"]

Apuntado. El enlace te llega antes de la clase. Un dato: los que entran a esta primera clase son los que de verdad acaban hablando alemán — los que la dejan "para luego" no vuelven. Nos vemos dentro.`,
  },
  refresh: {
    titulo: "✅ Confirmó hace días — toque corto para que no se enfríe",
    texto: (v) => `¡${v.nombre}! Sheila otra vez 😊

Me confirmaste tu clase con ${v.profe} y está todo listo: ${v.dia} a las ${v.hora} (hora de Alemania). Te doy un último toque porque ${v.profe} preparó tu clase y no quiero que ese trabajo se pierda.

¿Sigue en pie? Dime "ahí estaré" y no te molesto más hasta la clase 🙌`,
  },
  rescate: {
    titulo: "🔄 No asistió — rescatar SIN culpar, reagendar en la misma llamada",
    texto: (v) => `${v.nombre}, soy Sheila de Aprender Alemán 😊

${v.profe} te esperó en tu clase del ${v.dia} y no pudiste entrar — tranquilo/a, pasa en las mejores familias.

Pero te lo digo con cariño: el "luego lo retomo" es donde mueren todos los planes de aprender alemán. Tú diste el paso por algo — no lo dejes a medias.

Te mando ahora mismo el enlace para elegir nuevo horario, son 2 clics. ¿Qué te viene mejor, entre semana o fin de semana?

[si responde → mandar enlace de reagenda y quedarse hasta que elija hora]`,
  },
};

const REGLAS =
  "⚠️ Recuerda: NO vendas, NO des precios, NO prometas nada del plan. Si preguntan precio: «eso te lo explica el profesor en la clase — mi trabajo es que no te la pierdas 😊»";

export function buildGuion(tipo: GuionTipo, v: GuionVars): { titulo: string; texto: string; reglas: string } {
  const g = GUIONES[tipo];
  return { titulo: g.titulo, texto: g.texto(v), reglas: REGLAS };
}
