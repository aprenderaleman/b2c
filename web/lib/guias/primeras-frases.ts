// Guía de bienvenida «Tus primeras 30 frases en alemán», una por nivel.
// Regalo para quien se inscribe en las 48 h siguientes a su clase de
// prueba (misma regla que el bono de conversación); se descarga desde
// /estudiante/certificados. Quien la gana la conserva para siempre.

export type GuiaNivel = "A1" | "A2" | "B1" | "B2" | "C1";

export type Frase = { de: string; es: string };
export type Seccion = { titulo: string; consejo: string; frases: Frase[] };
export type Guia = { nivel: GuiaNivel; subtitulo: string; intro: string; secciones: Seccion[] };

const H = 3_600_000;

/**
 * ¿Se inscribió dentro de las 48 h posteriores a la clase de prueba?
 * - bono_conversacion_at: convertLeadToStudent ya lo comprobó con trial_attended_at.
 * - Si el profe no marcó la asistencia (cobró directamente en la clase),
 *   se mide desde la hora programada de la prueba (+1 h que dura la clase).
 * - Si marcó la asistencia después de convertir, también cuenta.
 */
export function guiaDisponible(a: {
  convertedAt:  string | null | undefined;
  bonoAt?:      string | null;
  attendedAt?:  string | null;
  scheduledAt?: string | null;
}): boolean {
  if (a.bonoAt) return true;
  if (!a.convertedAt) return false;
  const conv = new Date(a.convertedAt).getTime();
  if (a.attendedAt) {
    const d = conv - new Date(a.attendedAt).getTime();
    return d >= -24 * H && d <= 48 * H;
  }
  if (a.scheduledAt) {
    const d = conv - new Date(a.scheduledAt).getTime();
    return d >= 0 && d <= 49 * H;
  }
  return false;
}

/** A0 recibe la de A1 y C2 la de C1. */
export function guiaNivelPara(currentLevel: string | null | undefined): GuiaNivel {
  const l = String(currentLevel ?? "").toUpperCase();
  if (l === "A2" || l === "B1" || l === "B2" || l === "C1") return l;
  if (l === "C2") return "C1";
  return "A1";
}

export const GUIA_NIVELES: GuiaNivel[] = ["A1", "A2", "B1", "B2", "C1"];

export const GUIAS: Record<GuiaNivel, Guia> = {
  A1: {
    nivel: "A1",
    subtitulo: "Nivel A1 · Para arrancar desde cero",
    intro:
      "Con estas 30 frases ya puedes saludar, presentarte, pedir algo en una cafetería y, sobre todo, " +
      "pedir ayuda cuando no entiendas. Léelas en voz alta: la pronunciación se aprende con la boca, no con los ojos.",
    secciones: [
      {
        titulo: "Saludar y despedirse",
        consejo: "«Sie» es el trato formal (usted) y «du» el informal (tú). Ante la duda, usa «Sie».",
        frases: [
          { de: "Hallo! / Guten Tag!", es: "¡Hola! / ¡Buenos días!" },
          { de: "Guten Morgen!", es: "¡Buenos días! (por la mañana)" },
          { de: "Wie geht es Ihnen? – Wie geht's?", es: "¿Cómo está usted? – ¿Qué tal?" },
          { de: "Danke, gut. Und dir?", es: "Bien, gracias. ¿Y tú?" },
          { de: "Tschüss! / Auf Wiedersehen!", es: "¡Chao! / ¡Adiós!" },
        ],
      },
      {
        titulo: "Presentarte",
        consejo: "En alemán todos los sustantivos se escriben con mayúscula: der Name, die Arbeit, das Land.",
        frases: [
          { de: "Ich heiße Ana. / Mein Name ist Ana López.", es: "Me llamo Ana." },
          { de: "Ich komme aus Spanien.", es: "Soy de España." },
          { de: "Ich wohne in Madrid.", es: "Vivo en Madrid." },
          { de: "Ich arbeite als Krankenpfleger.", es: "Trabajo como enfermero." },
          { de: "Ich lerne Deutsch.", es: "Estoy aprendiendo alemán." },
        ],
      },
      {
        titulo: "Cuando no entiendes",
        consejo: "Estas son las frases más útiles de toda la guía: úsalas sin miedo en clase.",
        frases: [
          { de: "Wie bitte?", es: "¿Cómo? / ¿Perdón?" },
          { de: "Können Sie das bitte wiederholen?", es: "¿Puede repetirlo, por favor?" },
          { de: "Langsamer, bitte.", es: "Más despacio, por favor." },
          { de: "Was bedeutet „Brötchen“?", es: "¿Qué significa «Brötchen»?" },
          { de: "Ich verstehe das nicht.", es: "No lo entiendo." },
        ],
      },
      {
        titulo: "En la cafetería y de compras",
        consejo: "«ei» se pronuncia «ai» (zwei, Eis) e «ie» como una «i» larga (Bier, wie). «ö» y «ü» no existen en español: escúchalas en clase.",
        frases: [
          { de: "Einen Kaffee, bitte.", es: "Un café, por favor." },
          { de: "Ich möchte ein Wasser.", es: "Quisiera un agua." },
          { de: "Was kostet das?", es: "¿Cuánto cuesta?" },
          { de: "Die Rechnung, bitte.", es: "La cuenta, por favor." },
          { de: "Kann ich mit Karte zahlen?", es: "¿Puedo pagar con tarjeta?" },
        ],
      },
      {
        titulo: "La hora y las citas",
        consejo: "Días y horas van con preposición: «am Montag» (el lunes), «um 18 Uhr» (a las 18 h).",
        frases: [
          { de: "Wie spät ist es?", es: "¿Qué hora es?" },
          { de: "Es ist acht Uhr.", es: "Son las ocho." },
          { de: "Wann beginnt der Kurs?", es: "¿Cuándo empieza el curso?" },
          { de: "Am Montag um 18 Uhr.", es: "El lunes a las 18 h." },
          { de: "Meine Telefonnummer ist …", es: "Mi número de teléfono es …" },
        ],
      },
      {
        titulo: "Cortesía y reacciones",
        consejo: "«Bitte» sirve para todo: por favor, de nada y «aquí tiene». Úsalo mucho.",
        frases: [
          { de: "Bitte! / Danke schön!", es: "¡Por favor! / ¡Muchas gracias!" },
          { de: "Entschuldigung!", es: "¡Perdón! / Disculpe." },
          { de: "Kein Problem.", es: "No hay problema." },
          { de: "Super! / Toll!", es: "¡Genial!" },
          { de: "Bis morgen! / Bis bald!", es: "¡Hasta mañana! / ¡Hasta pronto!" },
        ],
      },
    ],
  },

  A2: {
    nivel: "A2",
    subtitulo: "Nivel A2 · Para moverte en el día a día",
    intro:
      "Ya te defiendes con lo básico. Estas 30 frases te llevan un paso más allá: hablar de tu rutina, " +
      "quedar con alguien, contar lo que hiciste el fin de semana y resolver citas y compras sin pasar apuros.",
    secciones: [
      {
        titulo: "Tu vida y tu rutina",
        consejo: "Verbos separables: «aufstehen» → «Ich stehe um sieben Uhr auf». El prefijo va al final.",
        frases: [
          { de: "Ich stehe jeden Tag um sieben Uhr auf.", es: "Me levanto todos los días a las siete." },
          { de: "Am Wochenende treffe ich gern Freunde.", es: "El fin de semana me gusta quedar con amigos." },
          { de: "Ich arbeite seit zwei Jahren in einem Hotel.", es: "Trabajo desde hace dos años en un hotel." },
          { de: "In meiner Freizeit lese ich viel.", es: "En mi tiempo libre leo mucho." },
          { de: "Ich habe zwei Geschwister.", es: "Tengo dos hermanos." },
        ],
      },
      {
        titulo: "Quedar y hacer planes",
        consejo: "Para proponer algo con naturalidad: «Wollen wir …?» o «Wie wäre es mit …?».",
        frases: [
          { de: "Hast du am Samstag Zeit?", es: "¿Tienes tiempo el sábado?" },
          { de: "Wollen wir zusammen ins Kino gehen?", es: "¿Vamos juntos al cine?" },
          { de: "Leider kann ich nicht, ich muss arbeiten.", es: "Lo siento, no puedo, tengo que trabajar." },
          { de: "Wie wäre es mit Freitag?", es: "¿Qué tal el viernes?" },
          { de: "Treffen wir uns um acht vor dem Bahnhof?", es: "¿Quedamos a las ocho delante de la estación?" },
        ],
      },
      {
        titulo: "Contar lo que has hecho",
        consejo: "Los verbos de movimiento forman el pasado con «sein»: «Ich bin gefahren», no «Ich habe gefahren».",
        frases: [
          { de: "Gestern habe ich lange gearbeitet.", es: "Ayer trabajé hasta tarde." },
          { de: "Am Wochenende bin ich nach Hamburg gefahren.", es: "El fin de semana fui a Hamburgo." },
          { de: "Wie war dein Urlaub?", es: "¿Qué tal tus vacaciones?" },
          { de: "Es war sehr schön, aber zu kurz.", es: "Fue muy bonito, pero demasiado corto." },
          { de: "Früher habe ich in Valencia gewohnt.", es: "Antes vivía en Valencia." },
        ],
      },
      {
        titulo: "Médico, citas y trámites",
        consejo: "«einen Termin vereinbaren» (pedir cita) es la expresión clave para el médico y la administración.",
        frases: [
          { de: "Ich möchte einen Termin vereinbaren.", es: "Quisiera pedir una cita." },
          { de: "Ich habe Kopfschmerzen und Fieber.", es: "Tengo dolor de cabeza y fiebre." },
          { de: "Haben Sie morgen Vormittag etwas frei?", es: "¿Tiene algo libre mañana por la mañana?" },
          { de: "Welche Unterlagen brauche ich?", es: "¿Qué documentos necesito?" },
          { de: "Können Sie mir das bitte aufschreiben?", es: "¿Me lo puede escribir, por favor?" },
        ],
      },
      {
        titulo: "Restaurante y tiendas",
        consejo: "«Ich hätte gern …» es más amable que «Ich will …»: úsalo para pedir.",
        frases: [
          { de: "Ich hätte gern einen Tisch für zwei Personen.", es: "Quisiera una mesa para dos personas." },
          { de: "Was können Sie empfehlen?", es: "¿Qué me recomienda?" },
          { de: "Ich esse kein Fleisch.", es: "No como carne." },
          { de: "Haben Sie das auch in Größe 40?", es: "¿Lo tiene también en la talla 40?" },
          { de: "Kann ich das umtauschen?", es: "¿Puedo cambiarlo?" },
        ],
      },
      {
        titulo: "Dar tu opinión",
        consejo: "Con «gefallen» la cosa es el sujeto: «Das Buch gefällt mir» (el libro me gusta).",
        frases: [
          { de: "Ich finde das sehr interessant.", es: "Me parece muy interesante." },
          { de: "Das gefällt mir (nicht).", es: "(No) me gusta." },
          { de: "Ich glaube, das ist eine gute Idee.", es: "Creo que es una buena idea." },
          { de: "Das ist mir egal.", es: "Me da igual." },
          { de: "Da hast du recht.", es: "Tienes razón." },
        ],
      },
    ],
  },

  B1: {
    nivel: "B1",
    subtitulo: "Nivel B1 · Para conversar con soltura",
    intro:
      "En B1 el reto es unir ideas, opinar y salir de situaciones imprevistas. Estas 30 frases son las que más " +
      "vas a usar para contar experiencias, argumentar, moverte en el trabajo y mantener viva una conversación.",
    secciones: [
      {
        titulo: "Contar experiencias",
        consejo: "Tras «weil», «obwohl» y «als» el verbo conjugado va al final de la frase.",
        frases: [
          { de: "Ich lerne Deutsch, weil ich in Deutschland arbeiten möchte.", es: "Aprendo alemán porque quiero trabajar en Alemania." },
          { de: "Als ich nach Berlin gekommen bin, habe ich kaum etwas verstanden.", es: "Cuando llegué a Berlín, apenas entendía nada." },
          { de: "Obwohl es anstrengend war, hat es sich gelohnt.", es: "Aunque fue agotador, valió la pena." },
          { de: "Zuerst …, danach … und zum Schluss …", es: "Primero …, después … y al final …" },
          { de: "Das Wichtigste für mich war …", es: "Lo más importante para mí fue …" },
        ],
      },
      {
        titulo: "Opinar y debatir",
        consejo: "«Meiner Meinung nach» ocupa la primera posición, así que el verbo va justo después: «Meiner Meinung nach ist das richtig».",
        frases: [
          { de: "Meiner Meinung nach …", es: "En mi opinión …" },
          { de: "Ich bin der Meinung, dass …", es: "Opino que …" },
          { de: "Einerseits …, andererseits …", es: "Por un lado …, por otro …" },
          { de: "Da bin ich anderer Meinung.", es: "En eso no estoy de acuerdo." },
          { de: "Das stimmt, aber man muss auch bedenken, dass …", es: "Es cierto, pero también hay que tener en cuenta que …" },
        ],
      },
      {
        titulo: "En el trabajo",
        consejo: "Con «Könnten wir …?» propones algo con cortesía, sin sonar exigente.",
        frases: [
          { de: "Ich bin für die Planung zuständig.", es: "Soy responsable de la planificación." },
          { de: "Ich habe Erfahrung im Kundenservice.", es: "Tengo experiencia en atención al cliente." },
          { de: "Könnten wir den Termin auf Donnerstag verschieben?", es: "¿Podríamos pasar la cita al jueves?" },
          { de: "Ich melde mich bis Freitag bei Ihnen.", es: "Le contesto antes del viernes." },
          { de: "Ich bewerbe mich um die Stelle als …", es: "Me presento al puesto de …" },
        ],
      },
      {
        titulo: "Resolver problemas",
        consejo: "Una queja eficaz en alemán es concreta: qué pasa, desde cuándo y qué esperas que hagan.",
        frases: [
          { de: "Ich möchte mich über … beschweren.", es: "Quisiera quejarme de …" },
          { de: "Die Heizung funktioniert seit drei Tagen nicht.", es: "La calefacción no funciona desde hace tres días." },
          { de: "Könnten Sie sich bitte darum kümmern?", es: "¿Podría ocuparse de ello, por favor?" },
          { de: "Was schlagen Sie vor?", es: "¿Qué propone?" },
          { de: "Ich hätte gern mein Geld zurück.", es: "Quisiera que me devolvieran el dinero." },
        ],
      },
      {
        titulo: "Deseos y planes",
        consejo: "«würde» + infinitivo es la forma fácil del condicional: «Ich würde gern reisen».",
        frases: [
          { de: "Wenn ich mehr Zeit hätte, würde ich öfter reisen.", es: "Si tuviera más tiempo, viajaría más a menudo." },
          { de: "Ich hätte Lust, am Wochenende wandern zu gehen.", es: "Me apetecería ir de excursión el fin de semana." },
          { de: "An deiner Stelle würde ich …", es: "Yo que tú …" },
          { de: "Ich habe vor, nächstes Jahr die Prüfung zu machen.", es: "Tengo pensado presentarme al examen el año que viene." },
          { de: "Es wäre schön, wenn …", es: "Sería bonito que …" },
        ],
      },
      {
        titulo: "Mantener la conversación",
        consejo: "No pasa nada por no saber una palabra: pide ayuda en alemán y la conversación sigue.",
        frases: [
          { de: "Wie meinst du das genau?", es: "¿Qué quieres decir exactamente?" },
          { de: "Habe ich das richtig verstanden, dass …?", es: "¿Lo he entendido bien? ¿Quieres decir que …?" },
          { de: "Moment, mir fällt das Wort gerade nicht ein.", es: "Un momento, ahora no me sale la palabra." },
          { de: "Wie sagt man auf Deutsch …?", es: "¿Cómo se dice en alemán …?" },
          { de: "Das ist ja interessant! Erzähl mal mehr.", es: "¡Qué interesante! Cuéntame más." },
        ],
      },
    ],
  },

  B2: {
    nivel: "B2",
    subtitulo: "Nivel B2 · Para sonar natural",
    intro:
      "En B2 ya no basta con hacerse entender: se trata de matizar, argumentar con precisión y sonar natural. " +
      "Estas 30 frases son las que más se oyen en debates, reuniones y conversaciones entre hablantes nativos.",
    secciones: [
      {
        titulo: "Debatir con argumentos",
        consejo: "«Das kommt darauf an» por sí sola ya es una respuesta muy natural: «depende».",
        frases: [
          { de: "Ich sehe das ein bisschen anders.", es: "Yo lo veo un poco distinto." },
          { de: "Das kommt darauf an, ob …", es: "Depende de si …" },
          { de: "Man darf nicht vergessen, dass …", es: "No hay que olvidar que …" },
          { de: "Ein wichtiges Argument dafür ist …", es: "Un argumento importante a favor es …" },
          { de: "Unterm Strich …", es: "En resumidas cuentas …" },
        ],
      },
      {
        titulo: "Matizar",
        consejo: "Matizar es lo que distingue un B2: evita los absolutos y gradúa lo que dices.",
        frases: [
          { de: "Im Großen und Ganzen stimme ich zu.", es: "En general estoy de acuerdo." },
          { de: "Das ist nur bedingt richtig.", es: "Eso solo es cierto en parte." },
          { de: "Soweit ich weiß, …", es: "Que yo sepa, …" },
          { de: "Es scheint, als ob …", es: "Parece como si …" },
          { de: "Ich will nicht ausschließen, dass …", es: "No quiero descartar que …" },
        ],
      },
      {
        titulo: "Reuniones y correos",
        consejo: "«Für Rückfragen stehe ich Ihnen gern zur Verfügung» es el cierre estándar de un correo profesional.",
        frases: [
          { de: "Lassen Sie uns kurz zusammenfassen.", es: "Resumamos brevemente." },
          { de: "Ich würde gern noch einen Punkt ergänzen.", es: "Me gustaría añadir un punto más." },
          { de: "Darauf komme ich gleich noch zurück.", es: "Sobre eso vuelvo enseguida." },
          { de: "Bezüglich Ihrer Anfrage …", es: "En relación con su consulta …" },
          { de: "Für Rückfragen stehe ich Ihnen gern zur Verfügung.", es: "Quedo a su disposición para cualquier consulta." },
        ],
      },
      {
        titulo: "Expresiones que usan los nativos",
        consejo: "Úsalas en contextos informales: en un correo formal sonarían fuera de lugar.",
        frases: [
          { de: "Ich drücke dir die Daumen!", es: "¡Mucha suerte! (lit.: te aprieto los pulgares)" },
          { de: "Das ist nicht mein Bier.", es: "No es asunto mío." },
          { de: "Ich verstehe nur Bahnhof.", es: "No entiendo nada. (lit.: solo entiendo «estación»)" },
          { de: "Der Teufel steckt im Detail.", es: "El diablo está en los detalles." },
          { de: "Das ist nur ein Katzensprung.", es: "Está a un paso. (lit.: un salto de gato)" },
        ],
      },
      {
        titulo: "Hipótesis y condiciones",
        consejo: "«Hätte ich das gewusst, …» sin «wenn»: el verbo pasa al principio y suena muy natural.",
        frases: [
          { de: "Hätte ich das früher gewusst, hätte ich anders entschieden.", es: "Si lo hubiera sabido antes, habría decidido de otra manera." },
          { de: "Angenommen, …", es: "Suponiendo que …" },
          { de: "Vorausgesetzt, dass …", es: "Siempre que … / Con la condición de que …" },
          { de: "Es könnte sein, dass …", es: "Podría ser que …" },
          { de: "Das hätte ich nicht gedacht.", es: "No me lo habría imaginado." },
        ],
      },
      {
        titulo: "Llevar la conversación",
        consejo: "Intervenir, reconducir y reformular: así llevas tú el ritmo de la conversación.",
        frases: [
          { de: "Wenn ich kurz einhaken darf: …", es: "Si me permites intervenir un momento: …" },
          { de: "Worauf willst du hinaus?", es: "¿Adónde quieres llegar?" },
          { de: "Mit anderen Worten: …", es: "Dicho de otro modo: …" },
          { de: "Um noch einmal auf … zurückzukommen: …", es: "Volviendo a …: …" },
          { de: "Das bringt mich auf eine Idee.", es: "Eso me da una idea." },
        ],
      },
    ],
  },

  C1: {
    nivel: "C1",
    subtitulo: "Nivel C1 · Para expresarte con precisión",
    intro:
      "En C1 cuentan el registro y la precisión. Estas 30 frases te ayudan a argumentar con rigor, escribir en " +
      "un registro formal, estructurar una presentación y negociar con diplomacia, como lo haría un hablante culto.",
    secciones: [
      {
        titulo: "Argumentar con rigor",
        consejo: "Las construcciones con «lässt sich» dan un tono objetivo, propio de textos académicos.",
        frases: [
          { de: "Es lässt sich nicht leugnen, dass …", es: "No se puede negar que …" },
          { de: "Dies wirft die Frage auf, ob …", es: "Esto plantea la cuestión de si …" },
          { de: "Daraus lässt sich schließen, dass …", es: "De ello se puede concluir que …" },
          { de: "Im Gegensatz dazu …", es: "Por el contrario …" },
          { de: "Nicht zuletzt deshalb, weil …", es: "Entre otras cosas, porque …" },
        ],
      },
      {
        titulo: "Conceder y rebatir",
        consejo: "Conceder primero y rebatir después hace tu argumento más convincente.",
        frases: [
          { de: "Zugegeben, …; dennoch …", es: "Hay que admitir que …; aun así …" },
          { de: "So berechtigt dieser Einwand auch sein mag, …", es: "Por justificada que sea esta objeción, …" },
          { de: "Das mag zwar stimmen, greift aber zu kurz.", es: "Puede que sea cierto, pero se queda corto." },
          { de: "Davon abgesehen …", es: "Aparte de eso …" },
          { de: "Das ist insofern problematisch, als …", es: "Esto es problemático en la medida en que …" },
        ],
      },
      {
        titulo: "Registro formal escrito",
        consejo: "En cartas formales evita el «ich» al principio de cada frase: varía con complementos delante.",
        frases: [
          { de: "Hiermit möchte ich Sie darauf aufmerksam machen, dass …", es: "Por la presente quisiera llamar su atención sobre el hecho de que …" },
          { de: "Im Hinblick auf …", es: "En lo que respecta a …" },
          { de: "Ich wäre Ihnen dankbar, wenn Sie … könnten.", es: "Le agradecería que pudiera …" },
          { de: "Wie bereits erwähnt, …", es: "Como ya se ha mencionado, …" },
          { de: "Abschließend lässt sich festhalten, dass …", es: "Para concluir, cabe señalar que …" },
        ],
      },
      {
        titulo: "Presentaciones",
        consejo: "Anuncia la estructura al principio y marca cada transición: el público te seguirá sin esfuerzo.",
        frases: [
          { de: "Im Folgenden möchte ich auf drei Aspekte eingehen.", es: "A continuación me gustaría abordar tres aspectos." },
          { de: "Damit komme ich zum nächsten Punkt.", es: "Con esto paso al siguiente punto." },
          { de: "Lassen Sie mich das an einem Beispiel veranschaulichen.", es: "Permítanme ilustrarlo con un ejemplo." },
          { de: "Zusammenfassend lässt sich sagen, dass …", es: "En resumen, se puede decir que …" },
          { de: "Gibt es dazu noch Fragen oder Anmerkungen?", es: "¿Hay alguna pregunta o comentario al respecto?" },
        ],
      },
      {
        titulo: "Expresiones idiomáticas cultas",
        consejo: "Bien colocadas, estas expresiones demuestran un dominio del idioma propio de C1.",
        frases: [
          { de: "Das ist ein zweischneidiges Schwert.", es: "Es un arma de doble filo." },
          { de: "Um es auf den Punkt zu bringen: …", es: "Para decirlo en pocas palabras: …" },
          { de: "Das steht auf einem anderen Blatt.", es: "Eso es harina de otro costal." },
          { de: "Man sollte nicht alles über einen Kamm scheren.", es: "No hay que medirlo todo por el mismo rasero." },
          { de: "Hier gilt es, Prioritäten zu setzen.", es: "Aquí se trata de establecer prioridades." },
        ],
      },
      {
        titulo: "Negociar con diplomacia",
        consejo: "El Konjunktiv II («wäre», «könnten», «sollten») suaviza cualquier propuesta o desacuerdo.",
        frases: [
          { de: "Ich gebe zu bedenken, dass …", es: "Quisiera hacer notar que …" },
          { de: "Wäre es denkbar, dass wir …?", es: "¿Sería posible que nosotros …?" },
          { de: "Ich verstehe Ihren Standpunkt, sehe aber einen anderen Weg.", es: "Entiendo su punto de vista, pero veo otro camino." },
          { de: "Vielleicht sollten wir das noch einmal in Ruhe besprechen.", es: "Quizá deberíamos volver a hablarlo con calma." },
          { de: "Darauf können wir uns gerne einigen.", es: "En eso podemos ponernos de acuerdo sin problema." },
        ],
      },
    ],
  },
};
