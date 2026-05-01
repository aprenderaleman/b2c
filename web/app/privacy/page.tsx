"use client";

import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";

export default function PrivacyPage() {
  const { lang } = useLang();
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        {lang === "de" ? <DE /> : <ES />}
      </main>
      <WhatsAppFloat />
    </>
  );
}

// ─────────────────────────────────────────────────────────
// ES
// ─────────────────────────────────────────────────────────

function ES() {
  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-3xl font-bold text-slate-900">Aviso legal y política de privacidad</h1>
      <p className="text-sm text-slate-500">Última actualización: 1 de mayo de 2026</p>

      {/* ═════════════ AVISO LEGAL (IMPRESSUM) ═════════════ */}
      <H1Section>Aviso legal (Impressum)</H1Section>

      <H2>Información según el § 5 de la Ley alemana de Servicios Digitales (DDG)</H2>
      <p>Aprender-Aleman.de es un servicio operado por:</p>
      <Block>
        <strong>Gelfis Horn</strong><br />
        Empresario individual (Einzelunternehmer)<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe<br />
        Alemania
      </Block>

      <H2>Contacto</H2>
      <Block>
        Email: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a><br />
        Web: <a href="https://aprender-aleman.de" target="_blank" rel="noopener noreferrer">https://aprender-aleman.de</a>
      </Block>

      <H2>Impuesto sobre el valor añadido (IVA)</H2>
      <p>
        De acuerdo con el § 19 UStG (régimen alemán de pequeños empresarios,
        <em> Kleinunternehmerregelung</em>), no se repercute IVA en nuestras facturas.
      </p>

      <H2>Responsable del contenido conforme al § 18 apdo. 2 MStV</H2>
      <Block>
        Gelfis Horn<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe<br />
        Alemania
      </Block>

      <H2>Resolución de litigios en línea (UE)</H2>
      <p>
        La Comisión Europea pone a disposición una plataforma para la
        resolución extrajudicial de litigios en línea (RLL):{" "}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>.
        Nuestra dirección de correo electrónico la encontrarás más arriba en
        este aviso legal.
      </p>

      <H2>Resolución alternativa de litigios de consumo</H2>
      <p>
        No estamos obligados ni dispuestos a participar en procedimientos
        de resolución de litigios ante un órgano de arbitraje de consumo.
      </p>

      <H2>Limitación de responsabilidad</H2>

      <H3>Responsabilidad por los contenidos</H3>
      <p>
        Como prestador de servicios somos responsables, conforme al § 7
        apdo. 1 DDG, de los contenidos propios publicados en estas páginas
        según las leyes generales. Sin embargo, conforme a los §§ 8 a 10
        DDG, no estamos obligados a supervisar las informaciones ajenas
        transmitidas o almacenadas, ni a investigar circunstancias que
        indiquen una actividad ilegal.
      </p>
      <p>
        Las obligaciones de retirar o bloquear el uso de informaciones
        conforme a las leyes generales no se ven afectadas. No obstante,
        una responsabilidad al respecto solo es posible a partir del
        momento en que se tenga conocimiento de una infracción concreta.
        Tan pronto como tengamos conocimiento de tales infracciones,
        eliminaremos los contenidos de inmediato.
      </p>
      <p>
        Los contenidos de nuestras páginas se han elaborado con el máximo
        cuidado. Sin embargo, no podemos garantizar la exactitud, integridad
        ni actualidad de los contenidos.
      </p>

      <H3>Responsabilidad por enlaces</H3>
      <p>
        Nuestra oferta contiene enlaces a sitios web externos de terceros
        sobre cuyos contenidos no tenemos influencia. Por este motivo, no
        podemos asumir ninguna responsabilidad por dichos contenidos
        ajenos. La responsabilidad por los contenidos de las páginas
        enlazadas corresponde siempre al respectivo proveedor o al titular
        de las páginas.
      </p>
      <p>
        Las páginas enlazadas se revisaron, en el momento de incluir el
        enlace, en busca de posibles infracciones. En el momento del
        enlace no se detectaron contenidos ilegales. No obstante, un
        control permanente de los contenidos de las páginas enlazadas no
        es exigible sin indicios concretos de una infracción. Si tenemos
        conocimiento de tales infracciones, eliminaremos dichos enlaces
        de inmediato.
      </p>

      <H3>Derechos de autor</H3>
      <p>
        Los contenidos y obras creados por el titular del sitio en estas
        páginas están sujetos a la legislación alemana sobre derechos de
        autor. La reproducción, modificación, distribución y cualquier
        tipo de explotación fuera de los límites de los derechos de autor
        requieren la autorización por escrito del autor o creador
        correspondiente.
      </p>
      <p>
        Las descargas y copias de esta página solo están permitidas para
        uso privado, no comercial. En la medida en que los contenidos de
        esta página no hayan sido creados por el titular, se respetan los
        derechos de autor de terceros. En particular, los contenidos de
        terceros están señalizados como tales. Si a pesar de ello tienes
        conocimiento de una infracción de derechos de autor, te rogamos
        que nos lo comuniques. Tan pronto como tengamos conocimiento de
        tales infracciones, eliminaremos dichos contenidos de inmediato.
      </p>

      {/* ═════════════ POLÍTICA DE PRIVACIDAD ═════════════ */}
      <H1Section>Política de privacidad</H1Section>

      <H2>1. Responsable del tratamiento</H2>
      <p>
        El responsable del tratamiento de tus datos personales conforme
        al Reglamento General de Protección de Datos (RGPD / DSGVO) es:
      </p>
      <Block>
        <strong>Gelfis Horn</strong><br />
        Empresario individual (Einzelunternehmer)<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe, Alemania<br />
        <br />
        Email: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a><br />
        Teléfono / WhatsApp: +49 1525 3409644
      </Block>
      <p>
        Operamos esta web para usuarios del Espacio Económico Europeo y
        especialmente de Alemania. Procesamos datos personales conforme
        al RGPD y a la legislación alemana de protección de datos
        (BDSG).
      </p>

      <H2>2. Datos que recopilamos</H2>
      <p>Tratamos las siguientes categorías de datos:</p>
      <Ul items={[
        <><strong>Del formulario web</strong> (funnel): nombre, número de WhatsApp, idioma detectado, nivel de alemán actual, meta de aprendizaje, urgencia, confirmación y fecha/hora del consentimiento RGPD.</>,
        <><strong>De la conversación WhatsApp</strong>: contenido de los mensajes que intercambias con nuestro asesor automatizado y con nuestro equipo, marcas temporales, acuses de recibo/lectura.</>,
        <><strong>Si agendas una clase de prueba</strong>: nombre completo, email, número de teléfono, fecha y hora de la cita.</>,
        <><strong>Notas internas</strong> añadidas por nuestro equipo sobre tu caso (objetivos, necesidades específicas, seguimiento).</>,
        <><strong>Datos técnicos mínimos</strong>: idioma del navegador y preferencia de idioma (almacenados en tu navegador mediante <code>localStorage</code>) y nombre temporal durante el paso final del formulario (<code>sessionStorage</code>, se borra al completar).</>,
      ]}/>

      <H2>3. Finalidades y base legal</H2>
      <p>Tratamos tus datos con las siguientes finalidades:</p>
      <Ul items={[
        <>Contactarte por WhatsApp para presentarte nuestros cursos, agendar una clase de prueba gratuita y responder a tus preguntas.</>,
        <>Diseñar un plan de estudio personalizado.</>,
        <>Gestionar la relación contractual si te conviertes en alumno.</>,
        <>Cumplimiento de obligaciones legales (facturación, contabilidad).</>,
      ]}/>
      <p>
        La base legal es tu <strong>consentimiento explícito</strong> (Art. 6
        apdo. 1 letra a RGPD), otorgado mediante la casilla obligatoria en el
        formulario. Para datos necesarios para la ejecución de la relación
        contractual, aplicamos el Art. 6 apdo. 1 letra b RGPD. Para el
        cumplimiento de obligaciones fiscales y contables, el Art. 6 apdo. 1
        letra c RGPD.
      </p>
      <p>
        Puedes retirar tu consentimiento en cualquier momento respondiendo a
        un mensaje nuestro con las palabras <em>"no me escriban más"</em>,{" "}
        <em>"cancelar"</em>, <em>"abmelden"</em> o similares, o enviándonos
        un email a <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>.
        La retirada no afecta la licitud del tratamiento realizado antes.
      </p>

      <H2>4. Proveedores de servicios (encargados del tratamiento)</H2>
      <p>Para operar el servicio utilizamos los siguientes encargados del tratamiento:</p>
      <ul className="list-disc pl-6 space-y-1">
        <Li><strong>Supabase Inc.</strong> (base de datos principal). Sede EE.UU. con infraestructura en la región de la UE (Frankfurt). Transferencia amparada en Cláusulas Contractuales Tipo (SCCs).</Li>
        <Li><strong>Hetzner Online GmbH</strong> (servidor WhatsApp Gateway). Sede en Alemania; no hay transferencia internacional.</Li>
        <Li><strong>WhatsApp Ireland Ltd. / Meta Platforms Inc.</strong> (transporte de mensajes WhatsApp). Transferencia amparada en SCCs.</Li>
        <Li><strong>Anthropic PBC</strong> (redacción asistida por IA de mensajes y respuestas). Sede EE.UU. Transferencia amparada en SCCs. Los mensajes de Claude no se usan para entrenar modelos (opt-out por defecto en la Claude API).</Li>
        <Li><strong>Vercel Inc.</strong> (hosting de la web aprender-aleman.de). Sede EE.UU. Transferencia amparada en SCCs.</Li>
        <Li><strong>Resend Inc.</strong> (envío de correos transaccionales). Sede EE.UU. Transferencia amparada en SCCs.</Li>
        <Li><strong>Stripe Payments Europe Ltd.</strong> (procesamiento de pagos). Sede en Irlanda.</Li>
        <Li><strong>Hostinger International Ltd.</strong> (DNS del dominio).</Li>
      </ul>
      <p>
        Cada uno ha firmado con nosotros un Acuerdo de Encargo del Tratamiento
        (DPA) y proporciona garantías conforme al Art. 28 RGPD.
      </p>

      <H2>5. Transferencias internacionales</H2>
      <p>
        Algunos de los proveedores citados procesan datos en Estados Unidos.
        Las transferencias se realizan con las <strong>Cláusulas Contractuales
        Tipo</strong> aprobadas por la Comisión Europea (Decisión de Ejecución
        2021/914) como mecanismo de garantía conforme al Art. 46 RGPD.
      </p>

      <H2>6. Plazos de conservación</H2>
      <ul className="list-disc pl-6 space-y-1">
        <Li>Lead activo en seguimiento: mientras exista interés o relación (incluye tu status de seguimiento y timeline).</Li>
        <Li>Lead marcado como <em>frío</em> o <em>perdido</em>: se archiva con anonimización parcial a los 24 meses.</Li>
        <Li>Alumnos convertidos: durante toda la relación contractual y 10 años posteriores por obligaciones contables alemanas (§ 147 AO).</Li>
        <Li>Mensajes WhatsApp: mismo plazo que el lead / alumno correspondiente.</Li>
        <Li>Solicitud de borrado (derecho al olvido, Art. 17 RGPD): eliminación en un máximo de 30 días. Se conserva sólo un hash irreversible del número para probar que atendimos la solicitud.</Li>
      </ul>

      <H2>7. Tus derechos</H2>
      <p>Conforme al RGPD, tienes derecho a:</p>
      <Ul items={[
        <><strong>Acceso</strong> (Art. 15): obtener copia de todos tus datos.</>,
        <><strong>Rectificación</strong> (Art. 16).</>,
        <><strong>Supresión / derecho al olvido</strong> (Art. 17).</>,
        <><strong>Limitación del tratamiento</strong> (Art. 18).</>,
        <><strong>Portabilidad</strong> (Art. 20): recibir tus datos en formato JSON estructurado.</>,
        <><strong>Oposición</strong> (Art. 21) al tratamiento.</>,
        <><strong>Retirada del consentimiento</strong> en cualquier momento (Art. 7.3).</>,
        <><strong>Reclamación ante la autoridad de control</strong>: en Alemania, la BfDI (<a href="https://www.bfdi.bund.de/" target="_blank" rel="noopener noreferrer">Bundesbeauftragte für den Datenschutz und die Informationsfreiheit</a>), o la autoridad del Land correspondiente.</>,
      ]}/>
      <p>
        Para ejercer cualquier derecho escríbenos a
        {" "}<a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>.
        Atendemos la solicitud en el plazo máximo de 30 días.
      </p>

      <H2>8. Cookies y almacenamiento local</H2>
      <p>
        No utilizamos cookies publicitarias ni de seguimiento en esta web.
        Únicamente guardamos en tu navegador (vía <code>localStorage</code>) tu
        preferencia de idioma para no volver a preguntártela. Durante el
        funnel, guardamos temporalmente tu nombre en <code>sessionStorage</code>
        para mostrártelo en la página de confirmación — esto se borra cuando
        cierras la pestaña. Ninguno de estos datos se envía a terceros.
      </p>

      <H2>9. Menores de edad</H2>
      <p>
        Este servicio está dirigido a personas mayores de 16 años. Si eres
        menor, necesitas consentimiento de tus padres o tutores antes de
        enviarnos tus datos.
      </p>

      <H2>10. Seguridad</H2>
      <p>
        Implementamos medidas técnicas y organizativas razonables:
        comunicaciones cifradas con TLS 1.2+, acceso restringido al panel de
        administración con autenticación de factor único y almacenamiento
        cifrado de contraseñas (bcrypt). Row-level security en la base de datos.
      </p>

      <H2>11. Cambios en esta política</H2>
      <p>
        Si actualizamos sustancialmente esta política te informaremos por el
        mismo canal WhatsApp. La versión vigente es siempre la publicada en
        {" "}<a href="https://b2c.aprender-aleman.de/privacy">
        b2c.aprender-aleman.de/privacy</a>.
      </p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────
// DE
// ─────────────────────────────────────────────────────────

function DE() {
  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-3xl font-bold text-slate-900">Impressum & Datenschutzerklärung</h1>
      <p className="text-sm text-slate-500">Stand: 1. Mai 2026</p>

      {/* ═════════════ IMPRESSUM ═════════════ */}
      <H1Section>Impressum</H1Section>

      <H2>Angaben gemäß § 5 DDG</H2>
      <p>Aprender-Aleman.de ist ein Angebot von:</p>
      <Block>
        <strong>Gelfis Horn</strong><br />
        Einzelunternehmer<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe<br />
        Deutschland
      </Block>

      <H2>Kontakt</H2>
      <Block>
        E-Mail: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a><br />
        Webseite: <a href="https://aprender-aleman.de" target="_blank" rel="noopener noreferrer">https://aprender-aleman.de</a>
      </Block>

      <H2>Umsatzsteuer</H2>
      <p>
        Gemäß § 19 UStG (Kleinunternehmerregelung) wird keine Umsatzsteuer
        ausgewiesen.
      </p>

      <H2>Inhaltlich Verantwortlicher gemäß § 18 Abs. 2 MStV</H2>
      <Block>
        Gelfis Horn<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe<br />
        Deutschland
      </Block>

      <H2>EU-Streitschlichtung</H2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{" "}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>.
        Unsere E-Mail-Adresse finden Sie oben im Impressum.
      </p>

      <H2>Verbraucherstreitbeilegung / Universalschlichtungsstelle</H2>
      <p>
        Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren
        vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>

      <H2>Haftungsausschluss</H2>

      <H3>Haftung für Inhalte</H3>
      <p>
        Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte
        auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach
        §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht
        verpflichtet, übermittelte oder gespeicherte fremde Informationen zu
        überwachen oder nach Umständen zu forschen, die auf eine
        rechtswidrige Tätigkeit hinweisen.
      </p>
      <p>
        Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
        Informationen nach den allgemeinen Gesetzen bleiben hiervon
        unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem
        Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich.
        Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir
        diese Inhalte umgehend entfernen.
      </p>
      <p>
        Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt.
        Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte
        können wir jedoch keine Gewähr übernehmen.
      </p>

      <H3>Haftung für Links</H3>
      <p>
        Unser Angebot enthält Links zu externen Websites Dritter, auf deren
        Inhalte wir keinen Einfluss haben. Deshalb können wir für diese
        fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der
        verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber
        der Seiten verantwortlich.
      </p>
      <p>
        Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf
        mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum
        Zeitpunkt der Verlinkung nicht erkennbar. Eine permanente
        inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne konkrete
        Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei
        Bekanntwerden von Rechtsverletzungen werden wir derartige Links
        umgehend entfernen.
      </p>

      <H3>Urheberrecht</H3>
      <p>
        Die durch die Seitenbetreiber erstellten Inhalte und Werke auf
        diesen Seiten unterliegen dem deutschen Urheberrecht. Die
        Vervielfältigung, Bearbeitung, Verbreitung und jede Art der
        Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der
        schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
      </p>
      <p>
        Downloads und Kopien dieser Seite sind nur für den privaten, nicht
        kommerziellen Gebrauch gestattet. Soweit die Inhalte auf dieser
        Seite nicht vom Betreiber erstellt wurden, werden die Urheberrechte
        Dritter beachtet. Insbesondere werden Inhalte Dritter als solche
        gekennzeichnet. Sollten Sie trotzdem auf eine Urheberrechtsverletzung
        aufmerksam werden, bitten wir um einen entsprechenden Hinweis. Bei
        Bekanntwerden von Rechtsverletzungen werden wir derartige Inhalte
        umgehend entfernen.
      </p>

      {/* ═════════════ DATENSCHUTZERKLÄRUNG ═════════════ */}
      <H1Section>Datenschutzerklärung</H1Section>

      <H2>1. Verantwortlicher (Art. 4 Nr. 7 DSGVO)</H2>
      <Block>
        <strong>Gelfis Horn</strong><br />
        Einzelunternehmer<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe, Deutschland<br />
        <br />
        E-Mail: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a><br />
        Telefon / WhatsApp: +49 1525 3409644
      </Block>
      <p>
        Da unsere Dienste sich unter anderem an Nutzer in Deutschland
        richten, verarbeiten wir personenbezogene Daten gemäß der
        EU-Datenschutz-Grundverordnung (DSGVO) und dem
        Bundesdatenschutzgesetz (BDSG).
      </p>

      <H2>2. Erhobene Daten</H2>
      <Ul items={[
        <><strong>Aus dem Web-Formular</strong>: Name, WhatsApp-Nummer, Sprache, aktuelles Deutsch-Niveau, Lernziel, Dringlichkeit, Einwilligung samt Zeitstempel.</>,
        <><strong>Aus der WhatsApp-Konversation</strong>: Inhalte der Nachrichten mit unserem Assistenten und unserem Team, Zeitstempel, Lesebestätigungen.</>,
        <><strong>Wenn du eine Probestunde buchst</strong>: Name, E-Mail, Telefonnummer, Datum und Uhrzeit.</>,
        <><strong>Interne Notizen</strong> unseres Teams zu deinem Fall (Ziele, Bedürfnisse, Betreuung).</>,
        <><strong>Minimale technische Daten</strong>: Sprachauswahl im Browser (<code>localStorage</code>), temporärer Name während des Funnels (<code>sessionStorage</code>, wird beim Schließen gelöscht).</>,
      ]}/>

      <H2>3. Zwecke & Rechtsgrundlage</H2>
      <Ul items={[
        <>Kontaktaufnahme per WhatsApp zur Kursberatung und Probestunde.</>,
        <>Erstellung eines persönlichen Lernplans.</>,
        <>Abwicklung der Kursteilnahme, falls du Schüler:in wirst.</>,
        <>Erfüllung gesetzlicher Pflichten (Buchhaltung, Steuer).</>,
      ]}/>
      <p>
        Rechtsgrundlage ist deine ausdrückliche <strong>Einwilligung</strong>
        {" "}(Art. 6 Abs. 1 lit. a DSGVO) über die Pflicht-Checkbox im Formular.
        Für vertragliche Leistungen Art. 6 Abs. 1 lit. b DSGVO. Für
        steuerrechtliche Pflichten Art. 6 Abs. 1 lit. c DSGVO.
      </p>
      <p>
        Du kannst deine Einwilligung jederzeit widerrufen — z. B. indem du
        mit <em>"bitte nicht mehr schreiben"</em>, <em>"abmelden"</em> oder{" "}
        <em>"stopp"</em> antwortest, oder eine E-Mail an
        {" "}<a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>
        {" "}schickst. Die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung
        bleibt unberührt.
      </p>

      <H2>4. Auftragsverarbeiter</H2>
      <ul className="list-disc pl-6 space-y-1">
        <Li><strong>Supabase Inc.</strong> (Datenbank). Sitz USA; Infrastruktur in EU-Region (Frankfurt). Übermittlung auf Grundlage von Standardvertragsklauseln (SCCs).</Li>
        <Li><strong>Hetzner Online GmbH</strong> (WhatsApp-Gateway-Server). Sitz in Deutschland; keine internationale Übermittlung.</Li>
        <Li><strong>WhatsApp Ireland Ltd. / Meta Platforms Inc.</strong> (Nachrichtenzustellung WhatsApp). Übermittlung auf Grundlage von SCCs.</Li>
        <Li><strong>Anthropic PBC</strong> (KI-Unterstützung beim Verfassen von Nachrichten). Sitz USA. SCCs vorhanden. Inhalte werden nicht zum Training von Modellen verwendet.</Li>
        <Li><strong>Vercel Inc.</strong> (Webhosting). Sitz USA. SCCs.</Li>
        <Li><strong>Resend Inc.</strong> (transaktionale E-Mails). Sitz USA. SCCs.</Li>
        <Li><strong>Stripe Payments Europe Ltd.</strong> (Zahlungsabwicklung). Sitz Irland.</Li>
        <Li><strong>Hostinger International Ltd.</strong> (DNS).</Li>
      </ul>
      <p>
        Mit allen wurden Verträge zur Auftragsverarbeitung (AVV) gemäß
        Art. 28 DSGVO geschlossen.
      </p>

      <H2>5. Internationale Datenübermittlung</H2>
      <p>
        Einige Auftragsverarbeiter verarbeiten Daten in den USA. Die
        Übermittlung erfolgt auf Grundlage der{" "}
        <strong>EU-Standardvertragsklauseln</strong> (Durchführungsbeschluss
        2021/914) als Garantie gemäß Art. 46 DSGVO.
      </p>

      <H2>6. Speicherdauer</H2>
      <ul className="list-disc pl-6 space-y-1">
        <Li>Aktiver Lead: solange Interesse besteht.</Li>
        <Li>Als <em>cold</em> / <em>lost</em> markierter Lead: archiviert, nach 24 Monaten teilweise anonymisiert.</Li>
        <Li>Kund:innen: gesamte Vertragsdauer plus 10 Jahre aufgrund handelsrechtlicher Aufbewahrungspflichten (§ 147 AO).</Li>
        <Li>WhatsApp-Nachrichten: analog zum jeweiligen Lead / Schüler.</Li>
        <Li>Löschungsanfragen (Art. 17 DSGVO): Umsetzung innerhalb von max. 30 Tagen. Es verbleibt nur ein unumkehrbarer Hash der Nummer zum Nachweis der erfolgten Löschung.</Li>
      </ul>

      <H2>7. Deine Rechte</H2>
      <Ul items={[
        <><strong>Auskunft</strong> (Art. 15).</>,
        <><strong>Berichtigung</strong> (Art. 16).</>,
        <><strong>Löschung</strong> (Art. 17).</>,
        <><strong>Einschränkung</strong> (Art. 18).</>,
        <><strong>Datenübertragbarkeit</strong> (Art. 20): JSON-Export.</>,
        <><strong>Widerspruch</strong> (Art. 21).</>,
        <><strong>Widerruf der Einwilligung</strong> (Art. 7 Abs. 3).</>,
        <><strong>Beschwerde</strong> bei der{" "}
          <a href="https://www.bfdi.bund.de/" target="_blank" rel="noopener noreferrer">
            BfDI</a> oder der zuständigen Landesdatenschutzbehörde.
        </>,
      ]}/>
      <p>
        Zur Ausübung schreibe an{" "}
        <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>.
        Antwort innerhalb von max. 30 Tagen.
      </p>

      <H2>8. Cookies & lokale Speicherung</H2>
      <p>
        Wir verwenden keine Werbe- oder Tracking-Cookies. Im Browser speichern
        wir lediglich deine Sprachpräferenz (<code>localStorage</code>) und
        temporär deinen Namen während des Funnels (<code>sessionStorage</code>
        , wird beim Schließen der Seite gelöscht). Diese Daten werden nicht an
        Dritte übermittelt.
      </p>

      <H2>9. Minderjährige</H2>
      <p>
        Unser Dienst richtet sich an Personen ab 16 Jahren. Für Minderjährige
        ist die Einwilligung der Erziehungsberechtigten erforderlich.
      </p>

      <H2>10. Sicherheit</H2>
      <p>
        TLS 1.2+, beschränkter Admin-Zugriff mit Passwort-Hashing, Row-Level-
        Security in der Datenbank. Passwörter werden mit bcrypt gespeichert.
      </p>

      <H2>11. Änderungen</H2>
      <p>
        Wesentliche Änderungen dieser Erklärung werden dir per WhatsApp
        mitgeteilt. Maßgeblich ist stets die Fassung unter
        {" "}<a href="https://b2c.aprender-aleman.de/privacy">
        b2c.aprender-aleman.de/privacy</a>.
      </p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function H1Section({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-12 pb-2 border-b border-slate-300 text-2xl font-bold uppercase tracking-wide text-slate-900">
      {children}
    </h2>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-8 text-xl font-semibold text-slate-900">{children}</h3>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h4 className="mt-5 text-base font-semibold text-slate-900">{children}</h4>;
}

function Block({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-xl bg-slate-50 border border-slate-200 p-4 text-slate-700 text-sm leading-relaxed">
      {children}
    </div>
  );
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-6 space-y-1">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}
