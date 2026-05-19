// Contenido de las 14 lecciones (A0–C2 × 2). Todo en alemán.
// Estructura por lección:
//   { level, n, slug, title, learningObjectives[], vocabulary[{de,es}],
//     grammar:{title, explanation, examples[]}, examples[],
//     classExercise, homework, summary,
//     workbookExercises[{title, instruction, content}] }

export const LECCIONES = [
  // ─────────────────────────────────────────────────────────
  // A0
  // ─────────────────────────────────────────────────────────
  {
    level: "A0", n: 1, slug: "alphabet-und-aussprache",
    title: "Das Alphabet und die Aussprache",
    learningObjectives: [
      "Das deutsche Alphabet vollständig nennen",
      "Die Umlaute ä, ö, ü und den Buchstaben ß erkennen",
      "Wörter auf Deutsch buchstabieren",
      "Die Aussprache typischer Laute üben (ch, sch, z, ei, ie)",
    ],
    vocabulary: [
      { de: "das Alphabet",        es: "el alfabeto" },
      { de: "der Buchstabe",       es: "la letra" },
      { de: "der Vokal",           es: "la vocal" },
      { de: "der Konsonant",       es: "la consonante" },
      { de: "der Umlaut",          es: "la diéresis (ä, ö, ü)" },
      { de: "buchstabieren",       es: "deletrear" },
      { de: "sprechen",            es: "hablar" },
      { de: "aussprechen",         es: "pronunciar" },
      { de: "wiederholen",         es: "repetir" },
      { de: "hören",               es: "escuchar" },
      { de: "die Aussprache",      es: "la pronunciación" },
      { de: "der Klang",           es: "el sonido" },
      { de: "laut",                es: "alto / fuerte" },
      { de: "leise",               es: "bajito / suave" },
      { de: "langsam",             es: "despacio" },
    ],
    grammar: {
      title: "Das Alphabet — 26 Buchstaben + ä, ö, ü, ß",
      explanation:
        "Das deutsche Alphabet hat 26 Standardbuchstaben (wie im Spanischen, aber ohne ñ) plus drei Umlaute (ä, ö, ü) und das Eszett (ß). Der Buchstabe ß wird in der Schweiz nicht verwendet — dort schreibt man ss.",
      examples: [
        "A, B, C, D, E, F, G, H, I, J, K, L, M",
        "N, O, P, Q, R, S, T, U, V, W, X, Y, Z",
        "Ä (a-Umlaut), Ö (o-Umlaut), Ü (u-Umlaut), ß (Eszett)",
        "ch in „ich“ (weich) — ch in „Bach“ (hart)",
        "sch in „Schule“ — wie spanisches ch ist hier NICHT korrekt",
      ],
    },
    examples: [
      "Wie buchstabiert man „Müller“? — M-Ü-Doppel-L-E-R",
      "Wie heißt du? — Ich heiße Anna. Anna mit zwei N.",
      "Die Straße heißt „Hauptstraße“ — Eszett, kein Doppel-S in Deutschland.",
    ],
    classExercise:
      "Buchstabier-Spiel: Jeder Schüler sagt seinen Vor- und Nachnamen und buchstabiert ihn auf Deutsch. Der Lehrer schreibt mit. Korrektur nach jedem Namen.",
    homework:
      "Schreib die Namen deiner Familie auf und buchstabiere sie laut. Notiere alle Buchstaben, die du schwierig findest — wir wiederholen sie in der nächsten Stunde.",
    summary:
      "Das deutsche Alphabet besteht aus 26 Buchstaben plus ä, ö, ü, ß. Die Aussprache der Umlaute und der Laute ch / sch / z ist anders als im Spanischen.",
    workbookExercises: [
      {
        title: "Übung 1 — Buchstaben erkennen",
        instruction: "Schreib das Alphabet von A bis Z auf Deutsch in die Zeile:",
        content: "_______________________________________________________________________",
      },
      {
        title: "Übung 2 — Umlaute",
        instruction: "Schreib die drei Umlaute als Groß- und Kleinbuchstabe:",
        content: "___  ___       ___  ___       ___  ___",
      },
      {
        title: "Übung 3 — Buchstabieren",
        instruction: "Wie buchstabiert man diese Wörter? Schreib jeden Buchstaben einzeln.",
        content:
          "a) Schule  →  ___ ___ ___ ___ ___ ___\n" +
          "b) Müller  →  ___ ___ ___ ___ ___ ___\n" +
          "c) Straße  →  ___ ___ ___ ___ ___ ___ ___\n" +
          "d) Bäcker  →  ___ ___ ___ ___ ___ ___ ___",
      },
      {
        title: "Übung 4 — Eigener Name",
        instruction: "Schreib deinen vollständigen Namen und buchstabiere ihn unten:",
        content:
          "Name: ____________________________\n" +
          "Buchstaben: _________________________________________",
      },
      {
        title: "Übung 5 — Hörverstehen",
        instruction: "Der Lehrer sagt 5 Wörter — schreib sie auf:",
        content: "1) ___________   2) ___________   3) ___________\n4) ___________   5) ___________",
      },
    ],
  },

  {
    level: "A0", n: 2, slug: "begruessungen-vorstellen",
    title: "Begrüßungen und sich vorstellen",
    learningObjectives: [
      "Formelle und informelle Begrüßungen verwenden",
      "Sich kurz vorstellen (Name, Herkunft, Wohnort, Beruf)",
      "Höflich Abschied nehmen",
      "Erste Fragen stellen (Wie heißt du? Woher kommst du?)",
    ],
    vocabulary: [
      { de: "Hallo!",                 es: "¡Hola!" },
      { de: "Guten Morgen!",          es: "¡Buenos días!" },
      { de: "Guten Tag!",             es: "¡Buenos días/tardes!" },
      { de: "Guten Abend!",           es: "¡Buenas tardes/noches!" },
      { de: "Gute Nacht!",            es: "¡Buenas noches! (al dormir)" },
      { de: "Tschüss!",               es: "¡Adiós! (informal)" },
      { de: "Auf Wiedersehen!",       es: "¡Hasta la vista!" },
      { de: "Bis bald!",              es: "¡Hasta pronto!" },
      { de: "heißen",                 es: "llamarse" },
      { de: "kommen aus",             es: "venir de" },
      { de: "wohnen in",              es: "vivir en" },
      { de: "der Name",               es: "el nombre" },
      { de: "das Land",               es: "el país" },
      { de: "die Stadt",              es: "la ciudad" },
      { de: "der Beruf",              es: "la profesión" },
    ],
    grammar: {
      title: "Personalpronomen + Verb „sein/heißen“ (1. und 2. Person)",
      explanation:
        "Im Deutschen konjugiert sich das Verb nach der Person. „Ich“ ist die 1. Person Singular, „du“ ist die 2. Person Singular (informell). Für „du“ + Verb: meistens endet das Verb auf -st.",
      examples: [
        "ich heiße — du heißt",
        "ich komme — du kommst",
        "ich wohne — du wohnst",
        "ich bin — du bist",
      ],
    },
    examples: [
      "Hallo! Ich heiße Lena. Wie heißt du?",
      "Ich komme aus Spanien. Und du? Woher kommst du?",
      "Ich wohne in München. Und du? Wo wohnst du?",
      "Ich bin Lehrerin. Was bist du von Beruf?",
    ],
    classExercise:
      "Speed-Dating in Paaren: Jeder Schüler stellt sich 1 Minute vor (Name, Land, Stadt, Beruf), dann Wechsel. Nach 4 Runden Plenum: jeder stellt seinen letzten Partner vor („Das ist Maria, sie kommt aus…“).",
    homework:
      "Schreib einen kurzen Text (4–5 Sätze) über dich selbst. Beantworte: Wie heißt du? Woher kommst du? Wo wohnst du? Was bist du von Beruf? Bring den Text in die nächste Stunde mit.",
    summary:
      "„Hallo“ ist informell; „Guten Tag“ ist formell. Im Deutschen ändert sich das Verb je nach Person: ich heiße / du heißt, ich komme / du kommst.",
    workbookExercises: [
      {
        title: "Übung 1 — Begrüßungen",
        instruction: "Welche Begrüßung passt? Verbinde:",
        content:
          "morgens (8:00 Uhr)        →   _____________________\n" +
          "abends (19:00 Uhr)        →   _____________________\n" +
          "Freundin treffen          →   _____________________\n" +
          "im Büro, formell          →   _____________________",
      },
      {
        title: "Übung 2 — Verben konjugieren",
        instruction: "Ergänze ich- und du-Form:",
        content:
          "heißen  →  ich heiße / du __________\n" +
          "kommen  →  ich __________ / du kommst\n" +
          "wohnen  →  ich wohne / du __________\n" +
          "sein    →  ich __________ / du bist",
      },
      {
        title: "Übung 3 — Lückentext",
        instruction: "Ergänze den Dialog:",
        content:
          "A: Hallo! Wie ____________ du?\n" +
          "B: Ich ____________ Pedro.\n" +
          "A: Woher ____________ du?\n" +
          "B: Ich komme ____________ Argentinien.\n" +
          "A: Und wo ____________ du jetzt?\n" +
          "B: Ich wohne ____________ Berlin.",
      },
      {
        title: "Übung 4 — Über dich schreiben",
        instruction: "Schreib 4 Sätze über dich:",
        content:
          "1) ________________________________________________\n" +
          "2) ________________________________________________\n" +
          "3) ________________________________________________\n" +
          "4) ________________________________________________",
      },
      {
        title: "Übung 5 — Abschied",
        instruction: "Welcher Abschied ist formell (F) oder informell (I)?",
        content:
          "(  )  Tschüss!\n" +
          "(  )  Auf Wiedersehen!\n" +
          "(  )  Bis bald!\n" +
          "(  )  Schönen Tag noch, Herr Müller!",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // A1
  // ─────────────────────────────────────────────────────────
  {
    level: "A1", n: 1, slug: "zahlen-uhrzeit-datum",
    title: "Zahlen, Uhrzeit und Datum",
    learningObjectives: [
      "Zahlen von 0 bis 1.000 verstehen und sagen",
      "Die Uhrzeit auf Deutsch nennen (formell und informell)",
      "Das Datum sagen und schreiben",
      "Termine auf Deutsch vereinbaren",
    ],
    vocabulary: [
      { de: "die Zahl",          es: "el número" },
      { de: "die Uhr",           es: "el reloj / la hora" },
      { de: "die Uhrzeit",       es: "la hora del día" },
      { de: "das Datum",         es: "la fecha" },
      { de: "der Tag",           es: "el día" },
      { de: "die Woche",         es: "la semana" },
      { de: "der Monat",         es: "el mes" },
      { de: "das Jahr",          es: "el año" },
      { de: "heute",             es: "hoy" },
      { de: "morgen",            es: "mañana" },
      { de: "gestern",           es: "ayer" },
      { de: "Wie spät ist es?",  es: "¿Qué hora es?" },
      { de: "Es ist … Uhr.",     es: "Son las …" },
      { de: "Viertel nach",      es: "y cuarto" },
      { de: "halb",              es: "y media (¡ojo: en alemán es 'halb 3' = 2:30!)" },
    ],
    grammar: {
      title: "Uhrzeit — formell vs. informell + Datum",
      explanation:
        "Formelle Uhrzeit (24h): „Es ist 14:30 Uhr“ = „vierzehn Uhr dreißig“. Informelle Uhrzeit (12h, Alltag): „halb drei“ bedeutet 2:30, NICHT 3:30! Das ist eine häufige Falle. „Viertel nach drei“ = 3:15. „Viertel vor vier“ = 3:45. Datum: „am 5. Mai 2026“ — die Endung -ten/-sten bei den Tagen.",
      examples: [
        "Es ist 14:00 Uhr.  → informell: „Es ist zwei.“",
        "Es ist 14:15 Uhr.  → „Viertel nach zwei“",
        "Es ist 14:30 Uhr.  → „halb drei“ (Achtung!)",
        "Es ist 14:45 Uhr.  → „Viertel vor drei“",
        "Heute ist der 12. Mai 2026.  → der zwölfte Mai",
      ],
    },
    examples: [
      "Wie spät ist es? — Es ist Viertel nach acht.",
      "Wann hast du Geburtstag? — Am 17. März.",
      "Der Unterricht beginnt um halb neun (8:30).",
      "Heute ist Donnerstag, der 14. Mai 2026.",
    ],
    classExercise:
      "Der Lehrer zeigt verschiedene Uhrzeiten (auf Papier oder Bildschirm). Die Schüler sagen die Zeit zuerst formell, dann informell. Danach: in Paaren — einer sagt eine Zeit, der andere zeichnet die Uhr.",
    homework:
      "Schreib deinen typischen Tag mit Uhrzeiten: „Um 7 Uhr stehe ich auf. Um halb acht frühstücke ich.“ Mindestens 6 Zeilen.",
    summary:
      "Achtung: „halb drei“ = 2:30, nicht 3:30! Im formellen Kontext (Bahn, Termine) wird die 24-Stunden-Form bevorzugt; im Alltag spricht man informell.",
    workbookExercises: [
      {
        title: "Übung 1 — Zahlen ausschreiben",
        instruction: "Schreib die Zahlen als Wort:",
        content:
          "7 → __________     13 → __________\n" +
          "21 → __________     45 → __________\n" +
          "100 → __________    365 → __________",
      },
      {
        title: "Übung 2 — Uhrzeiten (informell)",
        instruction: "Wie sagt man das informell?",
        content:
          "08:30 → __________________________\n" +
          "11:45 → __________________________\n" +
          "16:15 → __________________________\n" +
          "20:30 → __________________________\n" +
          "12:00 → __________________________",
      },
      {
        title: "Übung 3 — Datum",
        instruction: "Schreib das Datum aus:",
        content:
          "01.01.2026 → __________________________________\n" +
          "14.05.2026 → __________________________________\n" +
          "31.12.2026 → __________________________________",
      },
      {
        title: "Übung 4 — Terminvereinbarung",
        instruction: "Ergänze den Dialog:",
        content:
          "A: Wann treffen wir uns?\n" +
          "B: Hast du am __________ (Freitag) Zeit?\n" +
          "A: Ja, um wie viel ____________?\n" +
          "B: Um __________ (3:30 Uhr nachmittags)?\n" +
          "A: Perfekt!",
      },
      {
        title: "Übung 5 — Mein Tag",
        instruction: "Schreib 4 Aktivitäten deines Tages mit Uhrzeit:",
        content:
          "Um ____________ ___________________________________\n" +
          "Um ____________ ___________________________________\n" +
          "Um ____________ ___________________________________\n" +
          "Um ____________ ___________________________________",
      },
    ],
  },

  {
    level: "A1", n: 2, slug: "familie-possessivartikel",
    title: "Die Familie und Possessivartikel",
    learningObjectives: [
      "Familienmitglieder benennen",
      "Possessivartikel im Nominativ verwenden (mein, dein, sein, ihr, unser, euer, ihr)",
      "Die eigene Familie beschreiben",
      "Über das Alter sprechen",
    ],
    vocabulary: [
      { de: "die Familie",        es: "la familia" },
      { de: "der Vater",          es: "el padre" },
      { de: "die Mutter",         es: "la madre" },
      { de: "die Eltern (Pl.)",   es: "los padres" },
      { de: "der Bruder",         es: "el hermano" },
      { de: "die Schwester",      es: "la hermana" },
      { de: "die Geschwister",    es: "los hermanos (mixto)" },
      { de: "der Sohn",           es: "el hijo" },
      { de: "die Tochter",        es: "la hija" },
      { de: "die Kinder",         es: "los hijos / niños" },
      { de: "der Großvater / Opa",es: "el abuelo" },
      { de: "die Großmutter / Oma", es: "la abuela" },
      { de: "der Onkel",          es: "el tío" },
      { de: "die Tante",          es: "la tía" },
      { de: "der Cousin / die Cousine", es: "el primo / la prima" },
    ],
    grammar: {
      title: "Possessivartikel im Nominativ",
      explanation:
        "Possessivartikel zeigen Besitz. Sie passen sich dem Geschlecht und Numerus des Nomens an — NICHT dem Besitzer. Beispiel: 'mein Bruder' (maskulin), 'meine Schwester' (feminin), 'mein Kind' (neutrum), 'meine Eltern' (Plural). Maskulin/Neutrum: ohne -e. Feminin/Plural: mit -e.",
      examples: [
        "ich → mein/meine        wir → unser/unsere",
        "du → dein/deine         ihr → euer/eure",
        "er → sein/seine         sie/Sie → ihr/ihre · Ihr/Ihre",
        "sie (sg.) → ihr/ihre",
        "Beispiel: Mein Vater heißt Klaus. Meine Mutter heißt Petra.",
      ],
    },
    examples: [
      "Das ist meine Familie. Mein Vater heißt Klaus und meine Mutter heißt Petra.",
      "Hast du Geschwister? — Ja, ich habe einen Bruder. Sein Name ist Tim.",
      "Wie alt ist deine Schwester? — Sie ist 24 Jahre alt.",
      "Unsere Großeltern wohnen in Hamburg. Ihre Wohnung ist sehr groß.",
    ],
    classExercise:
      "Familienbaum: Jeder Schüler zeichnet einen einfachen Stammbaum (3 Generationen). Dann in Paaren: jeder erklärt seinem Partner die Familie auf Deutsch. „Das ist mein Großvater, sein Name ist…“",
    homework:
      "Schreib einen Text über deine Familie (8–10 Sätze). Erwähne mindestens 5 Personen mit Name, Alter und Beruf.",
    summary:
      "Possessivartikel hängen vom Nomen ab, nicht vom Besitzer: „mein Bruder“ aber „meine Schwester“. Plural bekommt immer -e: „meine Eltern“, „seine Kinder“.",
    workbookExercises: [
      {
        title: "Übung 1 — Familienmitglieder",
        instruction: "Verbinde die Wörter:",
        content:
          "Vater + Mutter        →   die ____________\n" +
          "Bruder + Schwester    →   die ____________\n" +
          "Opa + Oma             →   die ____________\n" +
          "Sohn + Tochter        →   die ____________",
      },
      {
        title: "Übung 2 — Possessivartikel (ich)",
        instruction: "Ergänze mit „mein“ oder „meine“:",
        content:
          "________ Vater       ________ Mutter\n" +
          "________ Bruder      ________ Schwester\n" +
          "________ Kind        ________ Eltern\n" +
          "________ Onkel       ________ Großeltern",
      },
      {
        title: "Übung 3 — Possessivartikel (er/sie/wir/ihr/sie)",
        instruction: "Setz den richtigen Possessivartikel ein:",
        content:
          "Er hat einen Bruder. ________ Bruder heißt Max.\n" +
          "Sie hat eine Tochter. ________ Tochter ist 5 Jahre alt.\n" +
          "Wir haben Kinder. ________ Kinder gehen zur Schule.\n" +
          "Habt ihr ein Auto? Ja, ________ Auto ist neu.\n" +
          "Sie (Plural) haben einen Hund. ________ Hund ist klein.",
      },
      {
        title: "Übung 4 — Über deine Familie schreiben",
        instruction: "Beantworte:",
        content:
          "Wie viele Geschwister hast du?  _________________________\n" +
          "Wie heißt dein Vater?           _________________________\n" +
          "Wie alt ist deine Mutter?       _________________________\n" +
          "Wo wohnen deine Großeltern?     _________________________",
      },
      {
        title: "Übung 5 — Mini-Text",
        instruction: "Schreib 5 Sätze über deine Familie:",
        content:
          "________________________________________________\n" +
          "________________________________________________\n" +
          "________________________________________________\n" +
          "________________________________________________\n" +
          "________________________________________________",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // A2
  // ─────────────────────────────────────────────────────────
  {
    level: "A2", n: 1, slug: "restaurant-akkusativ",
    title: "Im Restaurant — Essen bestellen (Akkusativ)",
    learningObjectives: [
      "Im Restaurant höflich bestellen und zahlen",
      "Den Akkusativ bei direkten Objekten korrekt verwenden",
      "Gerichte und Getränke benennen",
      "Über Geschmack und Vorlieben sprechen",
    ],
    vocabulary: [
      { de: "das Restaurant",     es: "el restaurante" },
      { de: "die Speisekarte",    es: "la carta / menú" },
      { de: "die Vorspeise",      es: "el entrante" },
      { de: "das Hauptgericht",   es: "el plato principal" },
      { de: "die Nachspeise",     es: "el postre" },
      { de: "der Kellner / die Kellnerin", es: "el camarero / la camarera" },
      { de: "bestellen",          es: "pedir / encargar" },
      { de: "bezahlen / zahlen",  es: "pagar" },
      { de: "die Rechnung",       es: "la cuenta" },
      { de: "das Trinkgeld",      es: "la propina" },
      { de: "schmecken",          es: "saber (a gusto)" },
      { de: "lecker",             es: "delicioso" },
      { de: "scharf",             es: "picante" },
      { de: "salzig",             es: "salado" },
      { de: "süß",                es: "dulce" },
    ],
    grammar: {
      title: "Der Akkusativ — direktes Objekt",
      explanation:
        "Der Akkusativ ist der Fall des direkten Objekts (was wird bestellt, gegessen, gekauft?). Nur der maskuline Artikel ändert sich: „der → den“, „ein → einen“. Feminin, Neutrum und Plural bleiben gleich. Fragen: Wen? Was?",
      examples: [
        "Maskulin: der Salat → den Salat   |   ein Salat → einen Salat",
        "Feminin: die Suppe → die Suppe    |   eine Suppe → eine Suppe",
        "Neutrum: das Brot → das Brot      |   ein Brot → ein Brot",
        "Plural: die Pommes → die Pommes",
        "Verben mit Akkusativ: bestellen, essen, trinken, nehmen, kaufen",
      ],
    },
    examples: [
      "Ich nehme den Salat als Vorspeise.",
      "Wir bestellen eine Pizza und zwei Bier.",
      "Möchten Sie das Tiramisu probieren?",
      "Die Rechnung, bitte! — Zusammen oder getrennt?",
    ],
    classExercise:
      "Rollenspiel im Restaurant: Ein Schüler ist Kellner, zwei sind Gäste. Sie spielen die ganze Situation — Begrüßung, Bestellung, „Hat es geschmeckt?“, Rechnung. Wechseln nach 5 Minuten.",
    homework:
      "Schreib einen Dialog (12–15 Zeilen) zwischen dir und einem Kellner. Du bestellst eine Vorspeise, ein Hauptgericht und eine Nachspeise. Markiere alle Akkusativ-Objekte.",
    summary:
      "Akkusativ = Wen/Was? Nur maskulin ändert sich (der → den, ein → einen). Im Restaurant verwendest du Akkusativ ständig: „Ich nehme den Fisch.“",
    workbookExercises: [
      {
        title: "Übung 1 — Artikel im Akkusativ",
        instruction: "Setz den richtigen Akkusativ-Artikel:",
        content:
          "Ich nehme ___ (der) Salat.\n" +
          "Er trinkt ___ (ein) Bier.\n" +
          "Wir bestellen ___ (die) Suppe und ___ (das) Brot.\n" +
          "Sie isst ___ (die, Pl.) Pommes.\n" +
          "Ich möchte ___ (eine) Pizza, bitte.",
      },
      {
        title: "Übung 2 — Speisekarte ergänzen",
        instruction: "Schreib auf Deutsch:",
        content:
          "Vorspeise: ________________________________\n" +
          "Hauptgericht: _____________________________\n" +
          "Nachspeise: _______________________________\n" +
          "Getränk: __________________________________",
      },
      {
        title: "Übung 3 — Dialog im Restaurant",
        instruction: "Ergänze den Dialog:",
        content:
          "Kellner: Was möchten Sie ___________________?\n" +
          "Gast:    Ich nehme ___ Schnitzel und ___ Bier.\n" +
          "Kellner: Und als Nachspeise?\n" +
          "Gast:    Ich möchte ___ Eis, bitte.\n" +
          "(später)\n" +
          "Gast:    Die _____________, bitte!\n" +
          "Kellner: Zusammen oder _______________?",
      },
      {
        title: "Übung 4 — Geschmack",
        instruction: "Welches Adjektiv passt?",
        content:
          "Zitrone → ____________________\n" +
          "Schokolade → ____________________\n" +
          "Chili → ____________________\n" +
          "Olive → ____________________",
      },
      {
        title: "Übung 5 — Höflichkeit",
        instruction: "Schreib höflichere Versionen mit „Ich möchte / Ich hätte gern“:",
        content:
          "„Bring mir ein Bier.“ →  __________________________________\n" +
          "„Ich will Wasser.“     →  __________________________________\n" +
          "„Gib mir die Karte.“   →  __________________________________",
      },
    ],
  },

  {
    level: "A2", n: 2, slug: "wegbeschreibung-dativ",
    title: "Wegbeschreibung (Dativ + Präpositionen)",
    learningObjectives: [
      "Nach dem Weg fragen und antworten",
      "Wechselpräpositionen mit Dativ verstehen (an, auf, in, neben, vor, hinter, über, unter, zwischen)",
      "Den Dativ bei Ortsbeschreibungen verwenden",
      "Eine Stadt oder ein Viertel beschreiben",
    ],
    vocabulary: [
      { de: "der Weg",            es: "el camino" },
      { de: "die Straße",         es: "la calle" },
      { de: "die Kreuzung",       es: "el cruce" },
      { de: "die Ampel",          es: "el semáforo" },
      { de: "die Ecke",           es: "la esquina" },
      { de: "geradeaus",          es: "todo recto" },
      { de: "links",              es: "izquierda" },
      { de: "rechts",             es: "derecha" },
      { de: "abbiegen",           es: "girar" },
      { de: "die Brücke",         es: "el puente" },
      { de: "das Gebäude",        es: "el edificio" },
      { de: "die Apotheke",       es: "la farmacia" },
      { de: "die Haltestelle",    es: "la parada (autobús, metro)" },
      { de: "weit",               es: "lejos" },
      { de: "in der Nähe",        es: "cerca" },
    ],
    grammar: {
      title: "Dativ — Ortsangaben mit Wechselpräpositionen",
      explanation:
        "Wechselpräpositionen (an, auf, in, neben, vor, hinter, über, unter, zwischen) brauchen Dativ bei Ortsangaben (Wo?). Maskulin: dem. Feminin: der. Neutrum: dem. Plural: den + -n am Nomen. Verschmelzungen: an dem → am, in dem → im, zu dem → zum, zu der → zur.",
      examples: [
        "Wo? + Dativ: „Das Café ist neben dem Park.“",
        "der Park → neben dem Park (m, Dativ)",
        "die Schule → vor der Schule (f, Dativ)",
        "das Restaurant → im Restaurant (n, Dativ; in dem = im)",
        "die Häuser → zwischen den Häusern (Pl., Dativ + -n)",
      ],
    },
    examples: [
      "Entschuldigung, wo ist die Post? — Geradeaus, dann an der Ampel rechts.",
      "Die Apotheke ist zwischen der Bank und dem Supermarkt.",
      "Geh über die Brücke und dann links. Die Haltestelle ist auf der linken Seite.",
      "Das Hotel liegt in der Nähe vom Bahnhof, ungefähr 200 Meter.",
    ],
    classExercise:
      "Stadtplan-Übung: Der Lehrer verteilt eine Karte (oder zeichnet sie an die Tafel). Schüler A wählt geheim ein Ziel; Schüler B fragt nach dem Weg. A beschreibt, B zeichnet. Vergleich am Ende.",
    homework:
      "Beschreib in 8–10 Sätzen den Weg von deiner Wohnung zur nächsten U-Bahn-Station / Bushaltestelle. Verwende mindestens 5 Wechselpräpositionen mit Dativ.",
    summary:
      "Wechselpräpositionen + Wo? = Dativ. Merke: in dem = im, an dem = am. Plural braucht -n am Nomen: „den Häusern“, „den Kindern“.",
    workbookExercises: [
      {
        title: "Übung 1 — Richtungen",
        instruction: "Übersetze ins Deutsche:",
        content:
          "todo recto       → ____________________\n" +
          "a la derecha     → ____________________\n" +
          "a la izquierda   → ____________________\n" +
          "girar a la izquierda → ____________________________\n" +
          "en el semáforo   → ____________________",
      },
      {
        title: "Übung 2 — Dativ-Artikel",
        instruction: "Ergänze mit „dem / der / dem / den“:",
        content:
          "neben ___ Park (m)\n" +
          "vor ___ Schule (f)\n" +
          "in ___ Restaurant (n)\n" +
          "zwischen ___ Häusern (Pl.)\n" +
          "an ___ Ampel (f)",
      },
      {
        title: "Übung 3 — Verschmelzungen",
        instruction: "Was bedeuten diese Verschmelzungen?",
        content:
          "im = in ____\n" +
          "am = an ____\n" +
          "zum = zu ____\n" +
          "zur = zu ____",
      },
      {
        title: "Übung 4 — Wegbeschreibung",
        instruction: "Ergänze:",
        content:
          "Geh ______________ (geradeaus), bis du _____ Ampel siehst.\n" +
          "____ ___ Ampel biegst du ___________ (a la derecha) ___.\n" +
          "Die Apotheke ist _______________ (al lado de) ___ Supermarkt.",
      },
      {
        title: "Übung 5 — Dein Weg",
        instruction: "Beschreib deinen Weg zu einem Lieblingsort (Café, Park…):",
        content:
          "Ziel: ____________________________________________\n" +
          "Weg: ____________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // B1
  // ─────────────────────────────────────────────────────────
  {
    level: "B1", n: 1, slug: "trennbare-verben-perfekt",
    title: "Trennbare Verben und das Perfekt",
    learningObjectives: [
      "Trennbare und untrennbare Präfixe unterscheiden",
      "Das Perfekt von schwachen, starken und gemischten Verben bilden",
      "Über Vergangenes mündlich erzählen",
      "Die Wortstellung in Hauptsätzen mit Perfekt beherrschen",
    ],
    vocabulary: [
      { de: "trennbar",           es: "separable" },
      { de: "untrennbar",         es: "no separable" },
      { de: "das Präfix",         es: "el prefijo" },
      { de: "das Partizip II",    es: "el participio pasado" },
      { de: "das Hilfsverb",      es: "el verbo auxiliar" },
      { de: "aufstehen",          es: "levantarse" },
      { de: "einkaufen",          es: "ir de compras" },
      { de: "ankommen",           es: "llegar" },
      { de: "abfahren",           es: "salir / partir" },
      { de: "mitnehmen",          es: "llevar (consigo)" },
      { de: "verstehen",          es: "entender (untrennbar)" },
      { de: "bekommen",           es: "recibir (untrennbar)" },
      { de: "erzählen",           es: "contar / narrar (untrennbar)" },
      { de: "gestern",            es: "ayer" },
      { de: "letzte Woche",       es: "la semana pasada" },
    ],
    grammar: {
      title: "Trennbare Verben + Perfekt mit haben/sein",
      explanation:
        "Trennbare Verben (an-, auf-, aus-, ein-, mit-, vor-, zu-, weg-, weiter-) trennen sich im Hauptsatz: 'Ich stehe um 7 Uhr auf.' Untrennbare Verben (be-, emp-, ent-, er-, ge-, miss-, ver-, zer-) trennen NIE und haben kein ge- im Partizip II: 'verstanden', 'bekommen'. Perfekt = haben/sein + Partizip II am Satzende. SEIN bei Bewegungs- und Zustandsverben (gehen, kommen, fahren, aufstehen, einschlafen).",
      examples: [
        "Trennbar Präsens:  Ich stehe um 7 Uhr auf.",
        "Trennbar Perfekt:  Ich bin um 7 Uhr aufgestanden.",
        "Untrennbar Perf.:  Ich habe das Wort verstanden.",
        "Regelmäßig: machen → gemacht; arbeiten → gearbeitet",
        "Stark: schreiben → geschrieben; gehen → gegangen (sein!)",
        "Gemischt: bringen → gebracht; denken → gedacht",
      ],
    },
    examples: [
      "Gestern bin ich früh aufgestanden und habe gefrühstückt.",
      "Wir haben am Wochenende eingekauft und sind ins Kino gegangen.",
      "Der Zug ist pünktlich angekommen, aber meine Freunde sind nicht mitgekommen.",
      "Ich habe alles verstanden, was er gesagt hat.",
    ],
    classExercise:
      "Erzähl-Kette: Jeder Schüler beschreibt sein gestriges Wochenende in 3 Sätzen mit Perfekt. Der nächste wiederholt einen Satz von vorher und fügt einen eigenen hinzu. Mindestens ein trennbares und ein untrennbares Verb pro Person.",
    homework:
      "Schreib einen Bericht (15 Sätze) über deine letzte Woche im Perfekt. Markiere alle trennbaren Verben blau und alle untrennbaren rot.",
    summary:
      "Trennbare Verben: Präfix springt ans Ende im Präsens, bleibt aber im Partizip II (aufgestanden). Untrennbare: kein 'ge-' im Partizip (verstanden, bekommen). Perfekt mit SEIN: Bewegung + Zustandsänderung.",
    workbookExercises: [
      {
        title: "Übung 1 — Trennbar oder untrennbar?",
        instruction: "Markiere T (trennbar) oder U (untrennbar):",
        content:
          "(  )  aufstehen      (  )  verstehen\n" +
          "(  )  einkaufen      (  )  bekommen\n" +
          "(  )  mitnehmen      (  )  erzählen\n" +
          "(  )  abfahren       (  )  besuchen\n" +
          "(  )  zumachen       (  )  entdecken",
      },
      {
        title: "Übung 2 — Partizip II bilden",
        instruction: "Schreib das Partizip II:",
        content:
          "machen       → __________\n" +
          "arbeiten     → __________\n" +
          "schreiben    → __________\n" +
          "gehen        → __________\n" +
          "aufstehen    → __________\n" +
          "verstehen    → __________\n" +
          "einkaufen    → __________\n" +
          "bekommen     → __________",
      },
      {
        title: "Übung 3 — haben oder sein?",
        instruction: "Setz das richtige Hilfsverb ein:",
        content:
          "Ich ___________ gestern um 7 Uhr aufgestanden.\n" +
          "Wir ___________ einen Film gesehen.\n" +
          "Er ___________ nach Berlin gefahren.\n" +
          "Sie ___________ das Buch gelesen.\n" +
          "Die Kinder ___________ ins Bett gegangen.",
      },
      {
        title: "Übung 4 — Perfekt-Sätze",
        instruction: "Schreib im Perfekt:",
        content:
          "(ich / aufstehen / früh)  →  ________________________________________\n" +
          "(wir / einkaufen / im Supermarkt)  →  __________________________________\n" +
          "(er / verstehen / nicht alles)  →  ____________________________________\n" +
          "(sie / ankommen / pünktlich)  →  ______________________________________",
      },
      {
        title: "Übung 5 — Mein gestriger Tag",
        instruction: "Erzähl deinen gestrigen Tag (8 Sätze, alles Perfekt):",
        content:
          "1) _______________________________________________\n" +
          "2) _______________________________________________\n" +
          "3) _______________________________________________\n" +
          "4) _______________________________________________\n" +
          "5) _______________________________________________\n" +
          "6) _______________________________________________\n" +
          "7) _______________________________________________\n" +
          "8) _______________________________________________",
      },
    ],
  },

  {
    level: "B1", n: 2, slug: "reisen-praeteritum-perfekt",
    title: "Reisen erzählen — Präteritum vs. Perfekt",
    learningObjectives: [
      "Den Unterschied zwischen Präteritum und Perfekt verstehen",
      "Reise- und Lebensgeschichten mündlich und schriftlich erzählen",
      "Modal- und Hilfsverben im Präteritum verwenden",
      "Die Vergangenheit stilistisch korrekt einsetzen",
    ],
    vocabulary: [
      { de: "die Reise",          es: "el viaje" },
      { de: "reisen",             es: "viajar" },
      { de: "das Reiseziel",      es: "el destino" },
      { de: "der Urlaub",         es: "las vacaciones" },
      { de: "die Erfahrung",      es: "la experiencia" },
      { de: "das Erlebnis",       es: "la vivencia" },
      { de: "sich erinnern an",   es: "acordarse de" },
      { de: "vergessen",          es: "olvidar" },
      { de: "die Kindheit",       es: "la infancia" },
      { de: "damals",             es: "entonces / en aquella época" },
      { de: "früher",             es: "antes" },
      { de: "plötzlich",          es: "de repente" },
      { de: "schließlich",        es: "finalmente" },
      { de: "danach",             es: "después" },
      { de: "der Bericht",        es: "el informe / la narración" },
    ],
    grammar: {
      title: "Präteritum vs. Perfekt — wann welches?",
      explanation:
        "Perfekt = mündliche Erzählung, alltägliche Gespräche, Briefe und kurze schriftliche Texte. Präteritum = schriftliche Erzählung, Romane, Berichte, Nachrichten, Märchen. AUSNAHME: sein, haben und die Modalverben (können, müssen, dürfen, wollen, sollen, mögen) bevorzugen IMMER das Präteritum, auch mündlich. Schwache Verben Präteritum: -te (machen → machte). Starke Verben: Vokalwechsel (gehen → ging, sehen → sah, kommen → kam).",
      examples: [
        "Mündlich (Perfekt): „Letzten Sommer bin ich nach Italien gereist.“",
        "Schriftlich (Präteritum): „Letzten Sommer reiste ich nach Italien.“",
        "Immer Präteritum: war, hatte, konnte, musste, wollte, sollte, durfte, mochte",
        "Mischform typisch: „Es war wunderschön und ich habe viel gesehen.“",
        "Starke Verben: ging, sah, kam, fuhr, fand, las, schrieb, sprach",
      ],
    },
    examples: [
      "Als ich 18 war, machte ich eine Reise durch Spanien. Ich besuchte viele Städte und lernte viele Menschen kennen.",
      "Mündlich: „Mit 18 habe ich eine Reise durch Spanien gemacht — es war fantastisch!“",
      "Plötzlich fing es an zu regnen, also gingen wir ins Café.",
      "Ich hatte damals kein Geld, aber ich wollte trotzdem reisen.",
    ],
    classExercise:
      "Erzählwettbewerb: Jeder Schüler erzählt 2 Minuten eine echte Reiseanekdote (Perfekt). Die anderen achten auf die Tempusverwendung und korrigieren am Ende. Bewertung: flüssig + korrekt + interessant.",
    homework:
      "Schreib eine Reisegeschichte (250 Wörter) im Präteritum (außer für haben/sein/Modalverben — die natürlich auch Präteritum). Mindestens 8 starke Verben verwenden.",
    summary:
      "Faustregel: gesprochen = Perfekt; geschrieben = Präteritum. AUSNAHME immer Präteritum: war, hatte, konnte, musste, wollte. Mischen ist okay, solange du nicht mitten im Satz wechselst.",
    workbookExercises: [
      {
        title: "Übung 1 — Präteritum-Formen",
        instruction: "Schreib die Präteritum-Form (er/sie/es):",
        content:
          "haben    → __________     sein     → __________\n" +
          "gehen    → __________     sehen    → __________\n" +
          "kommen   → __________     fahren   → __________\n" +
          "können   → __________     müssen   → __________\n" +
          "wollen   → __________     dürfen   → __________",
      },
      {
        title: "Übung 2 — Perfekt oder Präteritum?",
        instruction: "Welches Tempus passt besser? (P) für Perfekt, (Pr) für Präteritum:",
        content:
          "(   ) Roman-Anfang: „Es ____ einmal ein König…“\n" +
          "(   ) WhatsApp an einen Freund: „Ich ____ gerade im Café.“\n" +
          "(   ) Tageszeitung: „Der Präsident ____ gestern eine Rede.“\n" +
          "(   ) Telefonat mit der Oma: „Ich ____ gestern viel gelernt.“",
      },
      {
        title: "Übung 3 — Satz umformen",
        instruction: "Wandle vom Perfekt ins Präteritum um:",
        content:
          "Ich habe das Buch gelesen.   →  __________________________________\n" +
          "Wir sind nach Berlin gefahren.   →  ____________________________\n" +
          "Er hat seinen Pass vergessen.   →  _____________________________\n" +
          "Sie ist plötzlich aufgestanden.  →  ____________________________",
      },
      {
        title: "Übung 4 — Reisegeschichte ergänzen",
        instruction: "Setz die Verben im Präteritum ein:",
        content:
          "Letzten Sommer ____________ (reisen) ich nach Griechenland.\n" +
          "Ich ____________ (sein) drei Wochen dort und ____________ (besuchen)\n" +
          "viele Inseln. An einem Abend ____________ (gehen) ich in ein kleines\n" +
          "Restaurant am Hafen. Der Wirt ____________ (sprechen) Deutsch und wir\n" +
          "____________ (sich unterhalten) lange. Es ____________ (sein) ein\n" +
          "unvergesslicher Abend.",
      },
      {
        title: "Übung 5 — Deine Reise",
        instruction: "Erzähl von einer Reise (10 Sätze, hauptsächlich Präteritum):",
        content:
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // B2
  // ─────────────────────────────────────────────────────────
  {
    level: "B2", n: 1, slug: "konjunktiv-zwei",
    title: "Konjunktiv II — Wünsche, Höflichkeit und Hypothesen",
    learningObjectives: [
      "Konjunktiv II der wichtigsten Verben aktiv bilden",
      "Irreale Bedingungssätze (wenn … wäre / hätte) verstehen und verwenden",
      "Höfliche Bitten und Ratschläge formulieren",
      "Wünsche und Hypothesen ausdrücken",
    ],
    vocabulary: [
      { de: "der Wunsch",         es: "el deseo" },
      { de: "die Höflichkeit",    es: "la cortesía" },
      { de: "die Bedingung",      es: "la condición" },
      { de: "die Hypothese",      es: "la hipótesis" },
      { de: "der Ratschlag",      es: "el consejo" },
      { de: "raten",              es: "aconsejar" },
      { de: "wünschen",           es: "desear" },
      { de: "vermuten",           es: "suponer" },
      { de: "vorschlagen",        es: "proponer" },
      { de: "die Bitte",          es: "la petición" },
      { de: "irreal",             es: "irreal" },
      { de: "vorstellen (sich)",  es: "imaginar(se)" },
      { de: "ändern",             es: "cambiar" },
      { de: "an deiner Stelle",   es: "en tu lugar" },
      { de: "falls",              es: "en caso de que" },
    ],
    grammar: {
      title: "Konjunktiv II: würde / wäre / hätte / könnte",
      explanation:
        "Konjunktiv II drückt Irrealität, Höflichkeit, Wünsche und Hypothesen aus. Bildung: a) Für die meisten Verben: würde + Infinitiv. b) AUSNAHMEN — sein, haben, Modalverben + können/sollen/wollen/müssen/dürfen bilden eigene Formen, die häufig benutzt werden: wäre, hätte, könnte, sollte, wollte, müsste, dürfte. c) Bei starken Verben kann man auch direkt eine Konjunktiv-II-Form ableiten (käme, ginge, fände) — heute aber meist „würde kommen“.",
      examples: [
        "Höflich: „Könnten Sie mir bitte helfen?“ (statt: Können Sie…)",
        "Wunsch: „Ich wäre gern reich.“ / „Ich hätte gern eine Pause.“",
        "Irreal: „Wenn ich Zeit hätte, würde ich mehr lesen.“",
        "Ratschlag: „An deiner Stelle würde ich mit ihm sprechen.“",
        "Hypothese: „Wenn das stimmen würde, wäre das ein Problem.“",
      ],
    },
    examples: [
      "Ich hätte gern einen Espresso, bitte.",
      "Wenn ich mehr Geld hätte, würde ich eine Weltreise machen.",
      "Du solltest mit einem Arzt sprechen.",
      "An Ihrer Stelle würde ich das Angebot annehmen.",
    ],
    classExercise:
      "Würde-Spiel: Der Lehrer stellt 10 Wenn-Fragen („Was würdest du tun, wenn du im Lotto gewinnen würdest? / wenn du Bürgermeister wärst?“). Jeder Schüler antwortet spontan in 2–3 Sätzen mit Konjunktiv II.",
    homework:
      "Schreib einen Brief (200 Wörter) an dein „jüngeres Ich“ vor 10 Jahren. Gib ihm 5 Ratschläge mit Konjunktiv II. Beispiel: „An deiner Stelle würde ich…“",
    summary:
      "Konjunktiv II = höflich + irreal + Wünsche. Häufigste Formen: wäre, hätte, könnte, würde + Inf. Bei „wenn“-Sätzen geht Konjunktiv II in BEIDE Teile: „Wenn ich Zeit hätte, würde ich kommen.“",
    workbookExercises: [
      {
        title: "Übung 1 — Konjunktiv-II-Formen",
        instruction: "Setz ein (ich-Form):",
        content:
          "sein      → ____________\n" +
          "haben     → ____________\n" +
          "können    → ____________\n" +
          "müssen    → ____________\n" +
          "dürfen    → ____________\n" +
          "sollen    → ____________\n" +
          "wollen    → ____________",
      },
      {
        title: "Übung 2 — Höflichkeit",
        instruction: "Formuliere höflicher mit Konjunktiv II:",
        content:
          "„Geben Sie mir bitte Wasser.“  →  ________________________________\n" +
          "„Ich will einen Kaffee.“        →  ________________________________\n" +
          "„Können Sie das wiederholen?“   →  ________________________________\n" +
          "„Hilf mir bitte.“               →  ________________________________",
      },
      {
        title: "Übung 3 — Wünsche",
        instruction: "Vervollständige mit Konjunktiv II:",
        content:
          "Ich __________ (haben) gern ein Haus am Meer.\n" +
          "Wir __________ (sein) gern reicher.\n" +
          "Er __________ (können) eigentlich besser arbeiten.\n" +
          "Du __________ (sollen) mehr Pausen machen.",
      },
      {
        title: "Übung 4 — Irreale Bedingungen",
        instruction: "Verbinde die Sätze mit „wenn“:",
        content:
          "Beispiel: Ich habe keine Zeit. Ich lese nicht viel.\n" +
          "→ Wenn ich Zeit hätte, würde ich mehr lesen.\n\n" +
          "a) Ich bin nicht reich. Ich kaufe kein Haus.\n" +
          "   → __________________________________________________________\n" +
          "b) Sie wohnt weit weg. Wir sehen uns selten.\n" +
          "   → __________________________________________________________\n" +
          "c) Er spricht kein Deutsch. Er bekommt den Job nicht.\n" +
          "   → __________________________________________________________",
      },
      {
        title: "Übung 5 — Brief an dein jüngeres Ich",
        instruction: "Schreib 5 Ratschläge mit Konjunktiv II:",
        content:
          "1) An deiner Stelle ___________________________________________\n" +
          "2) Du solltest _______________________________________________\n" +
          "3) Es wäre gut, wenn _________________________________________\n" +
          "4) Ich würde _________________________________________________\n" +
          "5) Wenn ich du wäre, _________________________________________",
      },
    ],
  },

  {
    level: "B2", n: 2, slug: "passiv-unpersoenlich",
    title: "Passiv und unpersönliche Konstruktionen",
    learningObjectives: [
      "Vorgangs- und Zustandspassiv unterscheiden",
      "Aktiv ↔ Passiv umformen",
      "Unpersönliche Konstruktionen mit „man“ verwenden",
      "Passiv in Nachrichten- und Sachtexten verstehen",
    ],
    vocabulary: [
      { de: "das Passiv",         es: "la voz pasiva" },
      { de: "das Vorgangspassiv", es: "pasiva de proceso (werden)" },
      { de: "das Zustandspassiv", es: "pasiva de estado (sein)" },
      { de: "der Vorgang",        es: "el proceso" },
      { de: "der Zustand",        es: "el estado" },
      { de: "die Handlung",       es: "la acción" },
      { de: "der Täter",          es: "el agente" },
      { de: "verwenden / benutzen", es: "usar" },
      { de: "herstellen",         es: "fabricar" },
      { de: "veröffentlichen",    es: "publicar" },
      { de: "informieren",        es: "informar" },
      { de: "betonen",            es: "subrayar / enfatizar" },
      { de: "vermeiden",          es: "evitar" },
      { de: "man",                es: "uno / se (impersonal)" },
      { de: "öffentlich",         es: "público" },
    ],
    grammar: {
      title: "Passiv: werden + Partizip II (Vorgang) / sein + Partizip II (Zustand)",
      explanation:
        "Vorgangspassiv betont die Handlung selbst, nicht den Täter: „Die Tür wird geöffnet.“ (= jemand öffnet sie). Bildung: werden + Partizip II. Zeiten: Präsens „wird gemacht“, Perfekt „ist gemacht worden“ (achtung: worden, nicht geworden!), Präteritum „wurde gemacht“. Zustandspassiv betont das Ergebnis: „Die Tür ist geöffnet.“ (= sie steht offen). Wenn der Täter wichtig ist: „von + Dativ“. Alternative: „man“ + Aktiv ist oft natürlicher: „Man öffnet die Tür um 9 Uhr.“",
      examples: [
        "Aktiv: Der Lehrer korrigiert die Tests.",
        "Passiv: Die Tests werden korrigiert. (Vorgang)",
        "Passiv mit Täter: Die Tests werden vom Lehrer korrigiert.",
        "Perfekt: Die Tests sind korrigiert worden.",
        "Zustand: Die Tests sind korrigiert. (= fertig)",
        "Mit „man“: Man korrigiert die Tests jetzt.",
      ],
    },
    examples: [
      "Das neue Gesetz wird nächste Woche im Bundestag diskutiert.",
      "Das Buch ist 1922 veröffentlicht worden.",
      "In Deutschland wird viel Bier getrunken.",
      "Man darf hier nicht rauchen. (= Hier darf nicht geraucht werden.)",
    ],
    classExercise:
      "Nachrichten-Übung: Der Lehrer bringt 3 kurze Nachrichten-Schlagzeilen mit. Die Schüler lesen sie und identifizieren alle Passiv-Formen. Danach: jeder Schüler schreibt eine eigene Schlagzeile im Passiv.",
    homework:
      "Such einen kurzen Zeitungsartikel auf Deutsch (online). Markiere alle Passiv-Konstruktionen und schreib drei davon ins Aktiv um.",
    summary:
      "Vorgangspassiv = werden + Partizip II (betont Handlung). Zustandspassiv = sein + Partizip II (betont Ergebnis). Häufig: man + Aktiv ist eleganter. Im Perfekt: „worden“, nicht „geworden“!",
    workbookExercises: [
      {
        title: "Übung 1 — Aktiv → Passiv",
        instruction: "Wandle ins Vorgangspassiv um:",
        content:
          "Der Koch kocht die Suppe.   →  ________________________________________\n" +
          "Die Firma stellt Autos her.   →  _____________________________________\n" +
          "Der Autor schreibt das Buch.   →  ____________________________________\n" +
          "Die Polizei sucht den Dieb.   →  _____________________________________",
      },
      {
        title: "Übung 2 — Vorgang oder Zustand?",
        instruction: "Markiere V (Vorgang, werden) oder Z (Zustand, sein):",
        content:
          "(  ) Das Fenster wird geöffnet.\n" +
          "(  ) Das Fenster ist geöffnet.\n" +
          "(  ) Die Briefe sind geschrieben.\n" +
          "(  ) Die Briefe werden geschrieben.\n" +
          "(  ) Der Tisch ist gedeckt.\n" +
          "(  ) Der Tisch wird gerade gedeckt.",
      },
      {
        title: "Übung 3 — Passiv im Perfekt",
        instruction: "Setz im Perfekt ins Passiv:",
        content:
          "Sie haben den Brief geschickt.\n" +
          "→ Der Brief _______________________________________________________.\n\n" +
          "Sie haben das Haus 1980 gebaut.\n" +
          "→ Das Haus ______________________________________________________.\n\n" +
          "Wir haben die Tickets gekauft.\n" +
          "→ Die Tickets ___________________________________________________.",
      },
      {
        title: "Übung 4 — „man“-Konstruktion",
        instruction: "Wandle vom Passiv in „man“ um:",
        content:
          "Hier wird Deutsch gesprochen.   →  ____________________________________\n" +
          "Im Sommer wird viel gereist.    →  ____________________________________\n" +
          "Das Gesetz wird diskutiert.     →  ____________________________________\n" +
          "Der Müll wird recycelt.         →  ____________________________________",
      },
      {
        title: "Übung 5 — Mini-Nachrichtenartikel",
        instruction: "Schreib einen Nachrichtenabsatz (5 Sätze) mit mindestens 3 Passiv-Formen. Thema frei:",
        content:
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // C1
  // ─────────────────────────────────────────────────────────
  {
    level: "C1", n: 1, slug: "nominalstil-nebensaetze",
    title: "Nominalstil und komplexe Nebensätze",
    learningObjectives: [
      "Verbalen Stil in Nominalstil umformen (und umgekehrt)",
      "Komplexe Satzgefüge mit mehreren Nebensätzen verfassen",
      "Den richtigen Register für akademische und berufliche Texte wählen",
      "Stilfehler in eigenen Texten erkennen",
    ],
    vocabulary: [
      { de: "der Nominalstil",    es: "estilo nominal" },
      { de: "der Verbalstil",     es: "estilo verbal" },
      { de: "der Hauptsatz",      es: "oración principal" },
      { de: "der Nebensatz",      es: "oración subordinada" },
      { de: "die Konjunktion",    es: "la conjunción" },
      { de: "die Subjunktion",    es: "la conjunción subordinante" },
      { de: "die Substantivierung", es: "la nominalización" },
      { de: "der Bezug",          es: "la referencia" },
      { de: "die Verschachtelung", es: "el anidamiento" },
      { de: "präzise",            es: "preciso" },
      { de: "abstrakt",           es: "abstracto" },
      { de: "konkret",            es: "concreto" },
      { de: "umfassend",          es: "amplio / exhaustivo" },
      { de: "die Behörde",        es: "la administración / autoridad" },
      { de: "der Fachtext",       es: "texto especializado" },
    ],
    grammar: {
      title: "Nominalstil + Subjunktionen + Wortstellung im Nebensatz",
      explanation:
        "Nominalstil: ein Substantiv ersetzt eine ganze Verbalkonstruktion. „Nach der Beendigung der Sitzung…“ statt „Nachdem die Sitzung beendet worden war…“. Typisch für Behörden, Wissenschaft, Wirtschaft. Klingt formell, aber Vorsicht: zu viel Nominalstil = unleserlich. Subjunktionen leiten Nebensätze ein und schicken das Verb ans Satzende: weil, dass, wenn, obwohl, falls, nachdem, während, bevor, sodass, indem. Bei mehrfacher Verschachtelung: jeder Nebensatz hat eigene Komma-Grenzen.",
      examples: [
        "Verbal:  Nachdem das Meeting beendet wurde, gingen alle nach Hause.",
        "Nominal: Nach Beendigung des Meetings gingen alle nach Hause.",
        "Verbal:  weil es regnete → Nominal: aufgrund des Regens / wegen des Regens",
        "Komplex: „Die Tatsache, dass er, obwohl er müde war, dennoch kam, beeindruckte alle.“",
        "Subjunktionen: weil, dass, wenn, obwohl, falls, sodass, indem, nachdem, bevor",
      ],
    },
    examples: [
      "Aufgrund der gestiegenen Energiekosten ist mit Preiserhöhungen zu rechnen.",
      "Indem die Regierung die Steuern senkt, hofft sie, die Wirtschaft anzukurbeln.",
      "Trotz seines hohen Alters und obwohl er bereits erkrankt war, hielt er die Rede selbst.",
      "Die Beendigung des Projekts hängt von der Genehmigung durch den Vorstand ab.",
    ],
    classExercise:
      "Stil-Werkstatt: Der Lehrer verteilt 5 Sätze im Verbalstil. Schüler formen sie in Nominalstil um und umgekehrt. Diskussion: Welche Version ist klarer? Welche eleganter? Welche typisch für welchen Kontext?",
    homework:
      "Schreib einen kurzen formellen Text (200 Wörter) zum Thema „Auswirkungen der Digitalisierung auf den Arbeitsmarkt“. Verwende mindestens 5 Nominalkonstruktionen und 3 verschachtelte Nebensätze.",
    summary:
      "Nominalstil verdichtet Information, aber zu viel davon = trocken. Goldene Regel: 1–2 Nominalformen pro Absatz reichen. Bei verschachtelten Nebensätzen: Kommas penibel setzen, sonst verliert der Leser den Faden.",
    workbookExercises: [
      {
        title: "Übung 1 — Verbal → Nominal",
        instruction: "Forme um:",
        content:
          "Nachdem die Konferenz endete…\n" +
          "→ Nach _____________________________________________\n\n" +
          "Weil die Preise gestiegen sind…\n" +
          "→ Aufgrund _________________________________________\n\n" +
          "Wenn der Vertrag unterzeichnet ist…\n" +
          "→ Nach _____________________________________________\n\n" +
          "Indem man Energie spart…\n" +
          "→ Durch ____________________________________________",
      },
      {
        title: "Übung 2 — Nominal → Verbal",
        instruction: "Forme um:",
        content:
          "Wegen des Regens haben wir den Ausflug abgesagt.\n" +
          "→ Weil _____________________________________________\n\n" +
          "Trotz der Krise wuchs die Firma weiter.\n" +
          "→ Obwohl ___________________________________________\n\n" +
          "Nach Ankunft der Gäste begann das Programm.\n" +
          "→ Nachdem __________________________________________",
      },
      {
        title: "Übung 3 — Subjunktionen",
        instruction: "Wähl die passende Subjunktion (weil, obwohl, sodass, indem, falls):",
        content:
          "____________ er fleißig lernte, bestand er die Prüfung.\n" +
          "____________ es regnete, gingen wir spazieren.\n" +
          "Er war so krank, ____________ er nicht arbeiten konnte.\n" +
          "____________ du Fragen hast, ruf mich an.\n" +
          "Sie verbesserte ihr Deutsch, ____________ sie täglich übte.",
      },
      {
        title: "Übung 4 — Komplexer Satz",
        instruction: "Bau einen Satz mit 3 Nebensätzen aus diesen Fragmenten:",
        content:
          "Fragmente: er kam zu spät — sein Auto hatte eine Panne — der Stau war groß — er war wütend\n\n" +
          "Beispiel: Er war wütend, weil er zu spät kam, was daran lag, dass sein Auto eine Panne hatte, während der Stau groß war.\n\n" +
          "Dein Satz: ______________________________________________________\n" +
          "_______________________________________________________________\n" +
          "_______________________________________________________________",
      },
      {
        title: "Übung 5 — Eigener Fachtext",
        instruction: "Schreib 5 Sätze formellen Stils zum Thema „Klimawandel“ mit Nominalstil:",
        content:
          "1) _____________________________________________________\n" +
          "2) _____________________________________________________\n" +
          "3) _____________________________________________________\n" +
          "4) _____________________________________________________\n" +
          "5) _____________________________________________________",
      },
    ],
  },

  {
    level: "C1", n: 2, slug: "idiomatische-redewendungen",
    title: "Idiomatische Redewendungen",
    learningObjectives: [
      "Häufige Redewendungen erkennen und korrekt einsetzen",
      "Den Unterschied zwischen wörtlicher und bildlicher Bedeutung verstehen",
      "Stilebene und Kontext einer Redewendung einschätzen",
      "Eigene Sprechweise idiomatisch und natürlich gestalten",
    ],
    vocabulary: [
      { de: "die Redewendung",    es: "el modismo / la frase hecha" },
      { de: "die Wendung",        es: "la expresión" },
      { de: "der Spruch",         es: "el dicho" },
      { de: "die Bedeutung",      es: "el significado" },
      { de: "wörtlich",           es: "literal" },
      { de: "übertragen",         es: "figurado" },
      { de: "umgangssprachlich",  es: "coloquial" },
      { de: "veraltet",           es: "anticuado" },
      { de: "gängig",             es: "habitual" },
      { de: "der Kontext",        es: "el contexto" },
      { de: "anwenden",           es: "aplicar" },
      { de: "ausdrücken",         es: "expresar" },
      { de: "die Pointe",         es: "el chiste / punchline" },
      { de: "die Anspielung",     es: "la alusión" },
      { de: "passen",             es: "encajar / convenir" },
    ],
    grammar: {
      title: "Häufige Redewendungen — von alltäglich bis literarisch",
      explanation:
        "Redewendungen sind feste Wortverbindungen, deren Bedeutung NICHT aus den Einzelwörtern abgeleitet werden kann. „Das ist nicht mein Bier“ bedeutet nicht buchstäblich „kein Bier“, sondern „das ist nicht meine Angelegenheit“. Wichtig: Stilebene beachten — manche Wendungen sind alltagssprachlich, andere literarisch oder veraltet. Falsche Anwendung wirkt sofort komisch.",
      examples: [
        "„Das ist nicht mein Bier.“ = Das ist nicht meine Angelegenheit.",
        "„Ich verstehe nur Bahnhof.“ = Ich verstehe gar nichts.",
        "„Die Daumen drücken.“ = Jemandem Glück wünschen.",
        "„Den Nagel auf den Kopf treffen.“ = Genau richtig liegen.",
        "„Über seinen Schatten springen.“ = Etwas tun, was einem schwerfällt.",
        "„Ins kalte Wasser springen.“ = Etwas Neues ohne Vorbereitung anfangen.",
        "„Da haben wir den Salat.“ = Jetzt haben wir das Problem.",
        "„Tomaten auf den Augen haben.“ = Etwas Offensichtliches nicht sehen.",
        "„Auf Wolke sieben schweben.“ = Sehr glücklich / verliebt sein.",
        "„Eine Eselsbrücke bauen.“ = Eine Merkhilfe finden.",
      ],
    },
    examples: [
      "Als sie gefragt wurde, ob sie mitmacht, sagte sie: „Sorry, das ist nicht mein Bier.“",
      "Bei der Mathearbeit habe ich nur Bahnhof verstanden — sie war zu schwer.",
      "Drück mir die Daumen für mein Vorstellungsgespräch morgen!",
      "Mit deiner Analyse hast du den Nagel auf den Kopf getroffen.",
    ],
    classExercise:
      "Idiom-Memory: Der Lehrer schreibt 10 Redewendungen an die Tafel (ohne Bedeutung). Die Schüler raten die Bedeutung in Paaren. Nach 5 Minuten gemeinsam auflösen + jeder bildet einen eigenen Satz mit einer Wendung.",
    homework:
      "Schreib 5 kurze Mini-Dialoge (je 4 Zeilen), in denen je eine der Redewendungen aus der Vokabelliste vorkommt. Achte darauf, dass die Wendung im Kontext natürlich klingt.",
    summary:
      "Redewendungen sind das Salz in der Suppe der Fremdsprache: zu wenig = bleich, zu viel = ungenießbar. Faustregel: 1 Redewendung pro Absatz, immer passend zum Register.",
    workbookExercises: [
      {
        title: "Übung 1 — Bedeutung zuordnen",
        instruction: "Verbinde Redewendung ↔ Bedeutung:",
        content:
          "1) Die Daumen drücken         a) etwas Neues ohne Vorbereitung anfangen\n" +
          "2) Auf Wolke sieben schweben   b) genau richtig liegen\n" +
          "3) Den Nagel auf den Kopf treffen  c) jemandem Glück wünschen\n" +
          "4) Ins kalte Wasser springen   d) sehr glücklich sein\n" +
          "5) Tomaten auf den Augen haben  e) etwas Offensichtliches übersehen\n\n" +
          "Antworten: 1-__   2-__   3-__   4-__   5-__",
      },
      {
        title: "Übung 2 — Lückentext",
        instruction: "Setz die passende Redewendung ein:",
        content:
          "a) Bei dem Vortrag habe ich nur ____________ verstanden.\n" +
          "b) Mein Bruder will gar nicht heiraten — das ist nicht ____________.\n" +
          "c) Drück mir die ____________ für die Prüfung!\n" +
          "d) Mit seiner Diagnose hat der Arzt den ____________ getroffen.\n" +
          "e) Sie ist frisch verliebt und schwebt auf ____________.",
      },
      {
        title: "Übung 3 — Wörtlich oder übertragen?",
        instruction: "Welcher Satz benutzt die Wendung wörtlich (W) und welcher übertragen (Ü)?",
        content:
          "(  ) „Ich springe gleich ins kalte Wasser, der See ist erfrischend.“\n" +
          "(  ) „Ich springe nächste Woche ins kalte Wasser — mein erster Job.“\n" +
          "(  ) „Hast du Tomaten auf den Augen? Da steht das Schild!“\n" +
          "(  ) „Im Beet wachsen die Tomaten dieses Jahr besonders gut.“",
      },
      {
        title: "Übung 4 — Eigene Sätze",
        instruction: "Bilde je einen Satz mit den Redewendungen:",
        content:
          "Die Daumen drücken:\n" +
          "_______________________________________________\n\n" +
          "Den Nagel auf den Kopf treffen:\n" +
          "_______________________________________________\n\n" +
          "Eine Eselsbrücke bauen:\n" +
          "_______________________________________________\n\n" +
          "Da haben wir den Salat:\n" +
          "_______________________________________________",
      },
      {
        title: "Übung 5 — Mini-Dialog schreiben",
        instruction: "Schreib einen 6-zeiligen Dialog, in dem 2 verschiedene Redewendungen vorkommen:",
        content:
          "A: _________________________________________________\n" +
          "B: _________________________________________________\n" +
          "A: _________________________________________________\n" +
          "B: _________________________________________________\n" +
          "A: _________________________________________________\n" +
          "B: _________________________________________________",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // C2
  // ─────────────────────────────────────────────────────────
  {
    level: "C2", n: 1, slug: "stilebenen-kreatives-schreiben",
    title: "Stilebenen und kreatives Schreiben",
    learningObjectives: [
      "Verschiedene Stilebenen (formell, informell, literarisch, journalistisch) sicher unterscheiden",
      "Texte bewusst in einem gewählten Register verfassen",
      "Rhetorische Mittel (Metapher, Anapher, Hyperbel, Ironie) einsetzen",
      "Eigenen Schreibstil reflektieren und schärfen",
    ],
    vocabulary: [
      { de: "die Stilebene",      es: "el registro / nivel estilístico" },
      { de: "das Register",       es: "el registro lingüístico" },
      { de: "die Stilistik",      es: "la estilística" },
      { de: "rhetorisch",         es: "retórico" },
      { de: "die Metapher",       es: "la metáfora" },
      { de: "die Anapher",        es: "la anáfora" },
      { de: "die Hyperbel",       es: "la hipérbole" },
      { de: "die Ironie",         es: "la ironía" },
      { de: "der Topos",          es: "el tópico (literario)" },
      { de: "der Tenor",          es: "el tono general" },
      { de: "verdichten",         es: "condensar" },
      { de: "zuspitzen",          es: "agudizar / llevar al extremo" },
      { de: "der Erzähler",       es: "el narrador" },
      { de: "die Perspektive",    es: "la perspectiva" },
      { de: "der Subtext",        es: "el subtexto" },
    ],
    grammar: {
      title: "Stilebenen + rhetorische Mittel im kreativen Text",
      explanation:
        "Vier Hauptregister: a) formell-distanziert (Wissenschaft, Behörde) — Nominalstil, Passiv, Fachvokabular. b) standardsprachlich-neutral (Zeitung) — verbal aber präzise. c) umgangssprachlich (Chat, Alltag) — kurze Sätze, Modalpartikeln, Ellipse. d) literarisch (Belletristik) — Bilder, Rhythmus, gebrochene Syntax erlaubt. Auf C2-Niveau geht es nicht mehr um Korrektheit (vorausgesetzt), sondern um BEWUSSTE Wahl. Wichtige Stilmittel: Metapher („Sturm der Gefühle“), Anapher (Wiederholung am Satzanfang), Hyperbel (übertreibung), Ironie (Gegenteil meinen).",
      examples: [
        "Formell: „Der Antragsteller hat fristgerecht Einspruch erhoben.“",
        "Standard: „Er hat rechtzeitig Einspruch eingelegt.“",
        "Umgangssprachlich: „Er hat gerade noch so widersprochen.“",
        "Literarisch: „In letzter Minute, gleich einem Schatten, erhob er die Stimme.“",
        "Metapher: „Die Stadt schläft unter dem Mantel der Nacht.“",
        "Anapher: „Sie kam. Sie sah. Sie siegte.“",
        "Hyperbel: „Ich habe dir tausendmal gesagt…“",
        "Ironie: „Toll, dass es schon wieder regnet.“",
      ],
    },
    examples: [
      "Formell: „Der Vorstand beschließt einstimmig die Erhöhung der Beiträge ab dem 1. Januar.“",
      "Literarisch: „Der Winter kam wie ein ungebetener Gast, leise und kalt.“",
      "Umgangssprachlich: „Ey, der Winter haut richtig rein dieses Jahr.“",
      "Mit Anapher: „Diese Stadt vergisst nicht. Diese Stadt erinnert sich. Diese Stadt erzählt.“",
    ],
    classExercise:
      "Stilebenen-Workshop: Der Lehrer gibt einen kurzen Inhalt vor („Heute regnet es und ich gehe trotzdem joggen.“). Jeder Schüler schreibt 4 Versionen — formell, standardsprachlich, umgangssprachlich, literarisch — und liest sie laut vor. Diskussion: Welche Version trifft den Inhalt am besten? Welche überrascht?",
    homework:
      "Schreib einen literarischen Kurztext (300–400 Wörter) über einen einfachen Alltagsmoment (Kaffee am Morgen, Spaziergang, Telefonat). Bedingungen: mindestens 2 Metaphern, 1 Anapher und 1 Hyperbel oder Ironie. Markiere die Stilmittel am Rand.",
    summary:
      "Auf C2-Niveau ist die Frage nicht „ist das korrekt?“, sondern „ist das die richtige Stimme für diesen Text?“. Bewusst zwischen Registern wechseln zu können, ist die wahre Beherrschung der Sprache.",
    workbookExercises: [
      {
        title: "Übung 1 — Stilebene erkennen",
        instruction: "Welche Stilebene? (F=formell, S=standardsprachlich, U=umgangssprachlich, L=literarisch):",
        content:
          "(  )  „Bei Nichteinhaltung der Frist ergeht ein Bußgeldbescheid.“\n" +
          "(  )  „Wenn du zu spät kommst, kriegst du Knöllchen.“\n" +
          "(  )  „Die Schatten der Vergangenheit verflochten sich mit dem Licht der Gegenwart.“\n" +
          "(  )  „Die Verspätung führte zu einer Geldbuße.“",
      },
      {
        title: "Übung 2 — Stilebene wechseln",
        instruction: "Forme den Satz in 3 Stilebenen um:",
        content:
          "Inhalt: „Ich bin müde und gehe ins Bett.“\n\n" +
          "Formell:        _____________________________________________\n" +
          "Umgangssprachlich: __________________________________________\n" +
          "Literarisch:    _____________________________________________",
      },
      {
        title: "Übung 3 — Stilmittel identifizieren",
        instruction: "Welches Stilmittel? (M=Metapher, A=Anapher, H=Hyperbel, I=Ironie):",
        content:
          "(  )  „Ich habe schon eine Million Mal versucht anzurufen.“\n" +
          "(  )  „Ach, wie schön, dass du wieder vergessen hast, Brot zu kaufen.“\n" +
          "(  )  „Das Meer der Möglichkeiten lag vor ihm.“\n" +
          "(  )  „Wir wollen Freiheit. Wir wollen Würde. Wir wollen Zukunft.“",
      },
      {
        title: "Übung 4 — Eigene Stilmittel",
        instruction: "Bilde je ein Beispiel:",
        content:
          "Metapher: _____________________________________________\n" +
          "Anapher (3 Sätze): ____________________________________\n" +
          "________________________________________________________\n" +
          "________________________________________________________\n" +
          "Hyperbel: _____________________________________________\n" +
          "Ironie:   _____________________________________________",
      },
      {
        title: "Übung 5 — Kreativer Kurztext",
        instruction: "Schreib 100–150 Wörter literarisch zum Thema „Ein Fenster bei Nacht“. Mindestens 1 Metapher + 1 Anapher:",
        content:
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________",
      },
    ],
  },

  {
    level: "C2", n: 2, slug: "diskursanalyse-argumentation",
    title: "Diskursanalyse — Argumentation und Debatte",
    learningObjectives: [
      "Argumentationsstrukturen identifizieren und nachbauen",
      "Gegenargumente vorwegnehmen und entkräften",
      "Die typische Konnektoren der Argumentation einsetzen",
      "An einer Debatte auf Muttersprachenniveau teilnehmen",
    ],
    vocabulary: [
      { de: "das Argument",       es: "el argumento" },
      { de: "die These",          es: "la tesis" },
      { de: "die Antithese",      es: "la antítesis" },
      { de: "die Schlussfolgerung", es: "la conclusión" },
      { de: "der Beleg",          es: "la prueba / evidencia" },
      { de: "die Behauptung",     es: "la afirmación" },
      { de: "widerlegen",         es: "refutar" },
      { de: "entkräften",         es: "debilitar" },
      { de: "vorwegnehmen",       es: "anticipar" },
      { de: "der Trugschluss",    es: "la falacia" },
      { de: "die Prämisse",       es: "la premisa" },
      { de: "ausschlaggebend",    es: "decisivo" },
      { de: "fundiert",           es: "fundamentado" },
      { de: "abwägen",            es: "ponderar" },
      { de: "differenzieren",     es: "diferenciar" },
    ],
    grammar: {
      title: "Argumentations-Konnektoren + Diskursmarker",
      explanation:
        "Eine gute Argumentation besteht aus: 1) These (was behauptet wird), 2) Begründung (warum), 3) Beleg (Beispiel, Studie, Statistik), 4) Vorwegnahme von Gegenargumenten („zwar … aber“), 5) Schlussfolgerung. Wichtige Konnektoren: einerseits … andererseits, zwar … aber, dennoch, trotzdem, hingegen, demzufolge, folglich, infolgedessen, zumal, sofern, vorausgesetzt, dass, in Anbetracht dessen. Diskursmarker („meines Erachtens“, „es lässt sich festhalten“, „ein weiterer Aspekt“) strukturieren mündliche Beiträge.",
      examples: [
        "These + Beleg: „Bildung ist der Schlüssel zum sozialen Aufstieg, wie OECD-Studien wiederholt belegen.“",
        "Vorwegnahme: „Zwar kostet sie viel, dennoch ist der Nutzen langfristig größer.“",
        "Schlussfolgerung: „Demzufolge ist eine Investition in Bildung unerlässlich.“",
        "Differenzierung: „Es ist zu unterscheiden zwischen formaler und informeller Bildung.“",
        "Gegenargument entkräften: „Der Einwand, dass dies utopisch sei, übersieht, dass…“",
      ],
    },
    examples: [
      "Meines Erachtens ist die Energiewende alternativlos, zumal die Kosten konventioneller Energien stetig steigen.",
      "Zwar mag der kurzfristige Aufwand erheblich sein, dennoch überwiegen die langfristigen Vorteile bei weitem.",
      "Der häufig vorgebrachte Einwand, Künstliche Intelligenz koste Arbeitsplätze, übersieht, dass historisch jede technologische Revolution unterm Strich Arbeitsplätze geschaffen hat.",
      "In Anbetracht dieser Sachlage erscheint eine pauschale Ablehnung als wenig fundiert.",
    ],
    classExercise:
      "Pro-Contra-Debatte: Der Lehrer wirft ein kontroverses Thema in den Raum (z.B. „Bedingungsloses Grundeinkommen“, „Verbot von Verbrennungsmotoren ab 2035“). Die Klasse wird in 2 Gruppen geteilt — Pro und Contra, ZUFÄLLIG, unabhängig von der eigenen Meinung. 10 Min Vorbereitung, dann 15 Min Debatte. Wichtig: Gegenargumente vorwegnehmen + entkräften.",
    homework:
      "Schreib einen argumentativen Essay (400–500 Wörter) zu einer aktuellen gesellschaftlichen Frage deiner Wahl. Struktur: Einleitung, 3 Hauptargumente mit Belegen, 1 Gegenargument mit Entkräftung, Schlussfolgerung. Verwende mindestens 8 Argumentations-Konnektoren.",
    summary:
      "Auf C2-Niveau ist nicht entscheidend, was du denkst, sondern WIE du es zeigst. Eine starke Argumentation nimmt Gegenargumente vorweg, statt sie zu ignorieren — das ist der Unterschied zwischen Behauptung und Beweisführung.",
    workbookExercises: [
      {
        title: "Übung 1 — Konnektoren-Test",
        instruction: "Setz den passenden Konnektor ein (zwar … aber, dennoch, demzufolge, zumal, in Anbetracht dessen):",
        content:
          "a) ____________ ist die Aufgabe schwer, ____________ machbar.\n" +
          "b) Die Wirtschaft wächst langsamer. ____________ steigen die Preise.\n" +
          "c) Er hat Recht, ____________ die Daten ihn bestätigen.\n" +
          "d) ____________ erscheint eine Reform unausweichlich.\n" +
          "e) Es regnete stark; ____________ gingen wir spazieren.",
      },
      {
        title: "Übung 2 — Diskursmarker",
        instruction: "Vervollständige die mündlichen Diskursmarker:",
        content:
          "Anfang: __________ Erachtens ist…\n" +
          "Weiterer Punkt: ein __________ Aspekt ist…\n" +
          "Differenzierung: zu __________ ist hier zwischen X und Y…\n" +
          "Zusammenfassung: es lässt sich __________ , dass…\n" +
          "Schluss: in Anbetracht __________ ist anzunehmen, dass…",
      },
      {
        title: "Übung 3 — Vorwegnahme",
        instruction: "Vervollständige die Vorwegnahme von Gegenargumenten:",
        content:
          "a) Der Einwand, dass das Gesetz die Wirtschaft schwäche, _______________________,\n" +
          "   dass empirische Studien das Gegenteil belegen.\n\n" +
          "b) Zwar ist die kurzfristige Umstellung kostspielig, _______________________\n" +
          "   die langfristigen Einsparungen erheblich.\n\n" +
          "c) Häufig wird argumentiert, dass jüngere Generationen unpolitisch seien.\n" +
          "   Diese Behauptung _____________________ jedoch _______________________,\n" +
          "   dass das Engagement nur die Form gewechselt hat.",
      },
      {
        title: "Übung 4 — Argumentationskette",
        instruction: "Bau eine vollständige Argumentation (These → Begründung → Beleg → Gegenargument → Entkräftung → Schluss) zum Thema „Homeoffice“. Pro Schritt ein Satz:",
        content:
          "These: _____________________________________________\n" +
          "Begründung: ________________________________________\n" +
          "Beleg: _____________________________________________\n" +
          "Gegenargument: _____________________________________\n" +
          "Entkräftung: _______________________________________\n" +
          "Schluss: ___________________________________________",
      },
      {
        title: "Übung 5 — Mini-Essay",
        instruction: "Schreib einen Mini-Essay (150 Wörter) zu „Sollten soziale Netzwerke stärker reguliert werden?“. Verwende mindestens 5 Konnektoren der Argumentation:",
        content:
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________\n" +
          "_________________________________________________",
      },
    ],
  },
];
