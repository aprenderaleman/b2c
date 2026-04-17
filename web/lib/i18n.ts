export type Lang = "es" | "de";

export const translations = {
  es: {
    nav: {
      langLabel: "DE",
      whatsappLabel: "WhatsApp",
    },
    home: {
      tagline: "Academia online con profesores nativos + IA",
      title: "Aprender Alemán Online",
      subtitle:
        "Cursos intensivos con profesores nativos certificados. Prepárate para tu visa, estudios o trabajo en Alemania y Suiza con horarios flexibles y clases personalizadas.",
      advantage1Title: "Profesores nativos",
      advantage1Body:
        "Certificados, de Alemania y Suiza, que también hablan español.",
      advantage2Title: "Hans, tu profe IA 24/7",
      advantage2Body:
        "Practica por voz y texto cuando quieras, sin límite de horario.",
      advantage3Title: "Resultados garantizados",
      advantage3Body:
        "Plan personalizado para visa, trabajo, estudios o exámenes oficiales.",
      cta: "Comenzar ahora",
      footer: "© {year} Aprender-Aleman.de",
    },
    funnel: {
      progress: "Paso {n} de 5",
      back: "Atrás",
      next: "Siguiente",
      finish: "Finalizar",
      sending: "Enviando…",
      error: "Ocurrió un error. Intenta de nuevo.",
    },
    step1: {
      title: "¿Cuál es tu nivel de alemán actual?",
      options: {
        A0:     "Sin conocimientos (A0)",
        "A1-A2":"Principiante (A1-A2)",
        B1:     "Intermedio (B1)",
        "B2+":  "Avanzado (B2+)",
      },
    },
    step2: {
      title: "¿Cómo te llamas?",
      placeholder: "Tu nombre",
      error: "Escribe al menos 2 caracteres.",
    },
    step3: {
      title: "{name}, ¿para qué necesitas el alemán?",
      options: {
        work:             "Trabajar en Alemania o Suiza",
        visa:             "Obtener visa o residencia",
        studies:          "Estudiar en universidad alemana",
        exam:             "Examen oficial (Goethe, TELC)",
        travel:           "Viajes y cultura",
        already_in_dach:  "Ya vivo en DACH, quiero mejorar",
      },
    },
    step4: {
      title: "¿A qué número de WhatsApp te contactamos?",
      subtitle:
        "Solo te contactaremos con fines educativos. Sin spam.",
      phonePlaceholder: "152 5340 9644",
      gdprLabel:
        "Acepto recibir información educativa por WhatsApp de Aprender-Aleman.de.",
      gdprLink: "Ver política de privacidad",
      errorPhone: "Escribe un número válido.",
      errorGdpr: "Debes aceptar para continuar.",
    },
    step5: {
      title: "¿Cuándo necesitas lograr tu objetivo?",
      options: {
        asap:          "Lo antes posible",
        under_3_months:"Menos de 3 meses",
        in_6_months:   "En 6 meses",
        next_year:     "En el próximo año",
        just_looking:  "Solo estoy viendo",
      },
    },
    confirmation: {
      title: "¡Listo, {name}! 🎉",
      body:
        "Uno de nuestros asesores te contactará pronto por WhatsApp para diseñarte un plan a medida y agendarte una clase de prueba gratuita.",
      schuleHint:
        "Mientras tanto, empieza a practicar tu alemán gratis en SCHULE, nuestra aula virtual.",
      schuleCta: "Ir a SCHULE →",
    },
    privacy: {
      title: "Política de privacidad",
      lastUpdated: "Última actualización",
      placeholder:
        "Contenido pendiente. Gelfis completará este documento con el texto legal definitivo, incluyendo responsable del tratamiento, finalidades, base legal (consentimiento), transferencias a WhatsApp/Meta, derechos ARCO-POL y datos de contacto del DPO.",
    },
  },
  de: {
    nav: {
      langLabel: "ES",
      whatsappLabel: "WhatsApp",
    },
    home: {
      tagline: "Online-Akademie mit Muttersprachlern + KI",
      title: "Deutsch online lernen",
      subtitle:
        "Intensive Kurse mit zertifizierten muttersprachlichen Lehrern. Bereite dich auf dein Visum, Studium oder deinen Job in Deutschland und der Schweiz vor — mit flexiblen Zeiten und persönlichen Plänen.",
      advantage1Title: "Muttersprachliche Lehrer",
      advantage1Body:
        "Zertifiziert, aus Deutschland und der Schweiz, sprechen auch Spanisch.",
      advantage2Title: "Hans, dein KI-Lehrer 24/7",
      advantage2Body:
        "Übe per Sprache und Text, wann immer du willst — ohne Zeitlimit.",
      advantage3Title: "Garantierte Ergebnisse",
      advantage3Body:
        "Persönlicher Plan für Visum, Job, Studium oder offizielle Prüfungen.",
      cta: "Jetzt starten",
      footer: "© {year} Aprender-Aleman.de",
    },
    funnel: {
      progress: "Schritt {n} von 5",
      back: "Zurück",
      next: "Weiter",
      finish: "Fertig",
      sending: "Senden…",
      error: "Es ist ein Fehler aufgetreten. Bitte erneut versuchen.",
    },
    step1: {
      title: "Wie gut ist dein Deutsch aktuell?",
      options: {
        A0:     "Keine Kenntnisse (A0)",
        "A1-A2":"Anfänger (A1-A2)",
        B1:     "Mittelstufe (B1)",
        "B2+":  "Fortgeschritten (B2+)",
      },
    },
    step2: {
      title: "Wie heißt du?",
      placeholder: "Dein Name",
      error: "Bitte mindestens 2 Zeichen eingeben.",
    },
    step3: {
      title: "{name}, wofür brauchst du Deutsch?",
      options: {
        work:             "In Deutschland oder Schweiz arbeiten",
        visa:             "Visum oder Aufenthalt",
        studies:          "An einer deutschen Uni studieren",
        exam:             "Offizielle Prüfung (Goethe, TELC)",
        travel:           "Reisen und Kultur",
        already_in_dach:  "Lebe schon in DACH, möchte besser werden",
      },
    },
    step4: {
      title: "Auf welcher WhatsApp-Nummer kontaktieren wir dich?",
      subtitle:
        "Wir kontaktieren dich nur zu Bildungszwecken. Kein Spam.",
      phonePlaceholder: "152 5340 9644",
      gdprLabel:
        "Ich akzeptiere, Bildungsinformationen per WhatsApp von Aprender-Aleman.de zu erhalten.",
      gdprLink: "Datenschutzerklärung",
      errorPhone: "Bitte eine gültige Nummer eingeben.",
      errorGdpr: "Du musst zustimmen, um fortzufahren.",
    },
    step5: {
      title: "Bis wann möchtest du dein Ziel erreichen?",
      options: {
        asap:          "So schnell wie möglich",
        under_3_months:"In weniger als 3 Monaten",
        in_6_months:   "In 6 Monaten",
        next_year:     "Im nächsten Jahr",
        just_looking:  "Ich schaue nur",
      },
    },
    confirmation: {
      title: "Fertig, {name}! 🎉",
      body:
        "Einer unserer Berater kontaktiert dich in Kürze per WhatsApp, um einen persönlichen Plan zu erstellen und eine kostenlose Probestunde zu vereinbaren.",
      schuleHint:
        "In der Zwischenzeit kannst du schon kostenlos auf SCHULE, unserem virtuellen Klassenzimmer, üben.",
      schuleCta: "Zu SCHULE →",
    },
    privacy: {
      title: "Datenschutzerklärung",
      lastUpdated: "Zuletzt aktualisiert",
      placeholder:
        "Inhalt ausstehend. Gelfis wird diesen Text später mit dem endgültigen Rechtstext füllen: Verantwortlicher, Zwecke, Rechtsgrundlage (Einwilligung), Übermittlungen an WhatsApp/Meta, Betroffenenrechte und DSB-Kontakt.",
    },
  },
};

export type Translations = (typeof translations)["es"];

export function interpolate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function detectBrowserLang(): Lang {
  if (typeof navigator === "undefined") return "es";
  const first = (navigator.languages?.[0] ?? navigator.language ?? "es").toLowerCase();
  return first.startsWith("de") ? "de" : "es";
}
