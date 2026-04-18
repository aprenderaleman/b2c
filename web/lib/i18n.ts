export type Lang = "es" | "de";

export const translations = {
  es: {
    nav: {
      langLabel: "DE",
      whatsappLabel: "WhatsApp",
    },
    home: {
      tagline: "Academia Premium Online",
      title: "Aprender Alemán Online",
      subtitle:
        "Cursos intensivos con **profesores nativos certificados**. Prepárate para tu visa, estudios o trabajo en Alemania y Suiza con **clases personalizadas**.",
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
      ctaHint: "Gratis · 2 minutos · sin tarjeta",
      trust1Title: "Certificado Oficial",
      trust1Body:  "Marco Común Europeo",
      trust2Title: "Horarios Flexibles",
      trust2Body:  "A tu medida",
      trust3Title: "Profesores Bilingües",
      trust3Body:  "Nativos alemanes",
      // Mini-landing extras
      howItWorksTitle: "Cómo funciona",
      howItWorksSubtitle: "3 pasos · empiezas hoy mismo",
      step1Label: "Cuéntanos tu meta",
      step1Body:  "Dinos tu nivel, objetivo y horarios — 2 minutos.",
      step2Label: "Clase de prueba gratis",
      step2Body:  "Un profesor nativo evalúa tu nivel y diseña tu plan.",
      step3Label: "Avanza con tu plan",
      step3Body:  "Clases personalizadas + SCHULE + Hans 24/7.",
      faqTitle: "Preguntas frecuentes",
      faq1Q: "¿Se puede pasar de cero a B1 en 6 meses?",
      faq1A: "Sí. Con nuestro plan intensivo (clases 1-a-1 + práctica guiada en SCHULE + Hans 24/7), la mayoría de nuestros alumnos va de A0 a B1 en 6 meses. Tu profesor diseña el calendario en la primera clase según tu ritmo.",
      faq2Q: "¿Los profesores son de verdad nativos?",
      faq2A: "Sí — todos viven en Alemania o Suiza y están certificados oficialmente. Hablan español para explicar la gramática sin bloqueos.",
      faq3Q: "¿Puedo cancelar si no me gusta?",
      faq3A: "La clase de prueba es gratis y sin compromiso. Los planes tienen cancelación flexible — sin permanencia obligatoria.",
      faq4Q: "¿Preparan para Goethe o TELC?",
      faq4A: "Sí, con plan específico por examen y nivel (A1–C2). Nuestros alumnos tienen tasa de aprobado por encima de la media.",
      faq5Q: "¿Dónde veo los precios?",
      faq5A: "En la clase de prueba te damos el presupuesto exacto según tu meta y ritmo. No hay plantillas genéricas — cada plan se adapta.",
      finalCtaTitle: "Empieza hoy tu clase de prueba gratis",
      finalCtaBody:  "Sin compromiso, sin tarjeta. En 2 minutos quedas registrado y un asesor te contacta por WhatsApp.",
      finalCtaButton: "Quiero mi clase gratis →",
      examsTitle: "Preparación oficial Goethe & TELC",
      examsSubtitle:
        "Nuestros profesores nativos te preparan al detalle para aprobar los exámenes oficiales que exigen visa, universidad y trabajo en DACH.",
      examGoetheTitle: "Goethe-Zertifikat",
      examGoetheBody: "A1 · A2 · B1 · B2 · C1 · C2. El estándar internacional reconocido por embajadas y universidades alemanas.",
      examTelcTitle: "telc Deutsch",
      examTelcBody: "A1 · A2 · B1 · B2 · C1. Aceptado para la ciudadanía alemana (Einbürgerungstest) y para profesiones reguladas.",
      examsCTA: "Quiero prepararme →",
      footer: "© {year} Linguify Global LLC · Aprender-Aleman.de",
    },
    funnel: {
      progress: "Paso {n} de {total}",
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
    step6: {
      title: "¿Cuánto podrías invertir al mes en tu alemán?",
      subtitle: "No es un compromiso — nos ayuda a recomendarte el plan correcto.",
      options: {
        under_100:   "Menos de 100 €",
        "100_500":   "100 € – 500 €",
        "500_1000":  "500 € – 1000 €",
        "1000_3000": "1000 € – 3000 €",
        over_3000:   "Más de 3000 €",
        not_sure:    "Aún no lo sé",
      },
    },
    confirmation: {
      title: "¡Listo, {name}! 🎉",
      body:
        "Uno de nuestros asesores te contactará pronto por WhatsApp para diseñarte un plan a medida. Si prefieres, puedes agendar tu clase de prueba gratuita ahora mismo.",
      bookCtaTitle: "Reserva tu clase de prueba gratis",
      bookCtaBody:
        "Elige el horario que mejor te venga. Es 100% online, sin compromiso y sin tarjeta.",
      bookCtaButton: "Agendar mi clase ahora →",
      bookCtaHint:   "Toma 1 minuto · clase de 30 min con un profesor nativo",
      schuleHint:
        "Mientras tanto, empieza a practicar tu alemán gratis en SCHULE, nuestra aula virtual.",
      schuleCta: "Ir a SCHULE →",
    },
    booked: {
      badge: "Clase confirmada",
      title: "¡Perfecto! Tu clase de prueba está agendada 🎉",
      body:
        "Recibirás un recordatorio por correo con los detalles de la videollamada. Antes de la clase, un asesor te escribirá por WhatsApp para confirmar y conocer tu meta.",
      card1Title: "Revisa tu correo",
      card1Body:  "Ahí están el enlace de la videollamada y la hora exacta de la clase.",
      card2Title: "Te escribimos por WhatsApp",
      card2Body:  "Un asesor confirmará contigo y responderá cualquier duda antes de la clase.",
      card3Title: "Prepárate con SCHULE",
      card3Body:  "Mientras esperas, entra a SCHULE y empieza a practicar gratis.",
      schuleCta:  "Ir a SCHULE ahora →",
      homeCta:    "Volver al inicio",
      footNote:   "¿Necesitas cambiar la hora? Puedes hacerlo desde el correo de Calendly que acabas de recibir.",
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
      tagline: "Premium Online-Akademie",
      title: "Deutsch online lernen",
      subtitle:
        "Intensive Kurse mit **zertifizierten muttersprachlichen Lehrern**. Bereite dich auf Visum, Studium oder Job in Deutschland und der Schweiz vor — mit **persönlichen Plänen**.",
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
      ctaHint: "Kostenlos · 2 Minuten · ohne Karte",
      trust1Title: "Offizielles Zertifikat",
      trust1Body:  "Gemeinsamer Europäischer Referenzrahmen",
      trust2Title: "Flexible Zeiten",
      trust2Body:  "An deinen Alltag angepasst",
      trust3Title: "Zweisprachige Lehrer",
      trust3Body:  "Deutsche Muttersprachler",
      // Mini-landing extras
      howItWorksTitle: "So funktioniert's",
      howItWorksSubtitle: "3 Schritte · heute noch starten",
      step1Label: "Erzähl uns dein Ziel",
      step1Body:  "Sag uns dein Niveau, dein Ziel und deine Zeiten — 2 Minuten.",
      step2Label: "Kostenlose Probestunde",
      step2Body:  "Ein muttersprachlicher Lehrer testet dein Niveau und plant deinen Weg.",
      step3Label: "Starte mit deinem Plan",
      step3Body:  "Persönlicher Unterricht + SCHULE + Hans 24/7.",
      faqTitle: "Häufige Fragen",
      faq1Q: "Ist es möglich, in 6 Monaten von null auf B1 zu kommen?",
      faq1A: "Ja. Mit unserem Intensivplan (1-zu-1-Unterricht + geführtes Training auf SCHULE + Hans 24/7) schaffen die meisten unserer Schüler den Sprung von A0 auf B1 in 6 Monaten. Dein Lehrer plant den Fahrplan in der ersten Stunde nach deinem Tempo.",
      faq2Q: "Sind die Lehrer wirklich Muttersprachler?",
      faq2A: "Ja — alle leben in Deutschland oder der Schweiz und sind offiziell zertifiziert. Sie sprechen Spanisch, um die Grammatik verständlich zu erklären.",
      faq3Q: "Kann ich kündigen, wenn es mir nicht passt?",
      faq3A: "Die Probestunde ist gratis und unverbindlich. Die Pläne haben flexible Kündigung — keine feste Bindung.",
      faq4Q: "Bereitet ihr auf Goethe oder TELC vor?",
      faq4A: "Ja, mit einem gezielten Plan je nach Prüfung und Niveau (A1–C2). Unsere Schüler haben eine überdurchschnittliche Bestehensquote.",
      faq5Q: "Wo sehe ich die Preise?",
      faq5A: "In der Probestunde bekommst du das genaue Angebot, passend zu deinem Ziel und Tempo. Keine Standard-Pakete — jeder Plan ist individuell.",
      finalCtaTitle: "Starte heute deine kostenlose Probestunde",
      finalCtaBody:  "Unverbindlich, ohne Karte. In 2 Minuten bist du registriert und ein Berater meldet sich per WhatsApp.",
      finalCtaButton: "Ich will meine kostenlose Stunde →",
      examsTitle: "Offizielle Prüfungsvorbereitung Goethe & TELC",
      examsSubtitle:
        "Unsere Muttersprachler bereiten dich gezielt auf die offiziellen Prüfungen vor, die du für Visum, Studium und Job in DACH brauchst.",
      examGoetheTitle: "Goethe-Zertifikat",
      examGoetheBody: "A1 · A2 · B1 · B2 · C1 · C2. Der internationale Standard, anerkannt von Botschaften und deutschen Universitäten.",
      examTelcTitle: "telc Deutsch",
      examTelcBody: "A1 · A2 · B1 · B2 · C1. Anerkannt für die deutsche Einbürgerung und für reglementierte Berufe.",
      examsCTA: "Ich will mich vorbereiten →",
      footer: "© {year} Linguify Global LLC · Aprender-Aleman.de",
    },
    funnel: {
      progress: "Schritt {n} von {total}",
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
    step6: {
      title: "Wie viel könntest du monatlich in dein Deutsch investieren?",
      subtitle: "Keine Verpflichtung — hilft uns, den passenden Plan zu empfehlen.",
      options: {
        under_100:   "Weniger als 100 €",
        "100_500":   "100 € – 500 €",
        "500_1000":  "500 € – 1000 €",
        "1000_3000": "1000 € – 3000 €",
        over_3000:   "Mehr als 3000 €",
        not_sure:    "Weiß ich noch nicht",
      },
    },
    confirmation: {
      title: "Fertig, {name}! 🎉",
      body:
        "Einer unserer Berater kontaktiert dich in Kürze per WhatsApp, um dir einen persönlichen Plan zu erstellen. Du kannst deine kostenlose Probestunde aber auch direkt jetzt selbst buchen.",
      bookCtaTitle: "Buche deine kostenlose Probestunde",
      bookCtaBody:
        "Wähle den Termin, der dir am besten passt. 100 % online, unverbindlich, ohne Karte.",
      bookCtaButton: "Jetzt Probestunde buchen →",
      bookCtaHint:   "Dauert 1 Minute · 30-Min-Stunde mit einem muttersprachlichen Lehrer",
      schuleHint:
        "In der Zwischenzeit kannst du schon kostenlos auf SCHULE, unserem virtuellen Klassenzimmer, üben.",
      schuleCta: "Zu SCHULE →",
    },
    booked: {
      badge: "Termin bestätigt",
      title: "Perfekt! Deine Probestunde ist gebucht 🎉",
      body:
        "Du bekommst eine Erinnerung per E-Mail mit dem Videocall-Link. Vor der Stunde meldet sich ein Berater per WhatsApp, um zu bestätigen und dein Ziel kennenzulernen.",
      card1Title: "Check deine E-Mails",
      card1Body:  "Dort findest du den Videocall-Link und die genaue Uhrzeit der Stunde.",
      card2Title: "Wir schreiben dir auf WhatsApp",
      card2Body:  "Ein Berater bestätigt mit dir und beantwortet Fragen vor der Stunde.",
      card3Title: "Übe schon auf SCHULE",
      card3Body:  "Während du wartest, kannst du kostenlos auf SCHULE üben.",
      schuleCta:  "Jetzt zu SCHULE →",
      homeCta:    "Zurück zur Startseite",
      footNote:   "Brauchst du einen anderen Termin? Du kannst ihn über die Calendly-Mail ändern, die du gerade erhalten hast.",
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
