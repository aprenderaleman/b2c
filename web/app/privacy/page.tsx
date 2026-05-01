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
      <p className="text-sm text-slate-500">Última actualización: mayo de 2026</p>

      <H2>1. Responsable del tratamiento</H2>
      <p>
        El responsable del tratamiento en el sentido del Reglamento
        General de Protección de Datos (RGPD), de las leyes nacionales
        de protección de datos y de cualquier otra normativa aplicable
        en la materia es:
      </p>
      <Block>
        <strong>Gelfis Horn</strong><br />
        Empresario individual (<em>Einzelunternehmer</em>)<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe<br />
        Alemania<br />
        <br />
        Email: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>
      </Block>

      <H2>2. Aspectos generales sobre el tratamiento</H2>

      <H3>2.1 Alcance del tratamiento</H3>
      <p>
        Solo recopilamos y utilizamos datos personales de nuestros
        usuarios en la medida estrictamente necesaria para mantener la
        web operativa y prestar nuestros contenidos y servicios. La
        recopilación y el uso de datos personales se realiza, por regla
        general, únicamente con el consentimiento del usuario o cuando
        no es posible obtener dicho consentimiento previamente por
        razones de hecho y el tratamiento esté autorizado por
        disposiciones legales.
      </p>

      <H3>2.2 Bases jurídicas</H3>
      <p>
        Cuando recabamos el consentimiento del interesado para una
        operación de tratamiento, la base jurídica es el Art. 6 apdo. 1
        letra a RGPD.
      </p>
      <p>
        Cuando el tratamiento de datos personales sea necesario para la
        ejecución de un contrato, la base jurídica es el Art. 6 apdo. 1
        letra b RGPD. Esto se aplica también a los tratamientos
        necesarios para llevar a cabo medidas precontractuales.
      </p>
      <p>
        Cuando el tratamiento sea necesario para la satisfacción de
        intereses legítimos perseguidos por nuestra empresa o por un
        tercero, y siempre que sobre dichos intereses no prevalezcan los
        intereses, derechos y libertades fundamentales del interesado,
        la base jurídica es el Art. 6 apdo. 1 letra f RGPD.
      </p>

      <H3>2.3 Supresión de datos y plazo de conservación</H3>
      <p>
        Los datos personales del interesado se suprimirán o bloquearán
        en cuanto deje de existir la finalidad de su almacenamiento.
        Adicionalmente, podrá conservarse información si así lo prevé el
        legislador europeo o nacional en reglamentos de la Unión, leyes
        u otras disposiciones a las que esté sujeto el responsable.
        Asimismo, los datos se bloquearán o suprimirán cuando expire el
        plazo de conservación previsto por las normas mencionadas, salvo
        que sea necesaria una conservación adicional para la
        celebración o la ejecución de un contrato.
      </p>

      <H2>3. Provisión del sitio web y creación de archivos de registro (logs)</H2>

      <H3>3.1 Descripción y alcance del tratamiento</H3>
      <p>
        Cada vez que se accede a nuestro sitio web, nuestro sistema
        registra automáticamente datos e información del sistema
        informático del equipo que realiza la consulta. Se recogen los
        siguientes datos:
      </p>
      <Ul items={[
        <>Dirección IP del usuario</>,
        <>Fecha y hora del acceso</>,
        <>Tipo y versión del navegador utilizado</>,
        <>Sistema operativo del usuario</>,
        <>URL de origen (la página visitada anteriormente)</>,
        <>Páginas consultadas y volumen de datos transferido</>,
      ]}/>
      <p>
        Estos datos también quedan registrados en los archivos de log
        de nuestro sistema. No se almacenan junto con otros datos
        personales del usuario.
      </p>

      <H3>3.2 Hosting</H3>
      <p>
        Alojamos nuestras webs <a href="https://aprender-aleman.de">aprender-aleman.de</a>
        {" "}y <a href="https://schule.aprender-aleman.de">schule.aprender-aleman.de</a>
        {" "}en Hostinger International Ltd., 61 Lordou Vironos Street, 6023
        Larnaca, Chipre (en adelante "Hostinger"). Hostinger trata datos
        personales exclusivamente por cuenta nuestra y conforme a un
        contrato de encargado del tratamiento de acuerdo con el
        Art. 28 RGPD.
      </p>

      <H3>3.3 Base jurídica y finalidad</H3>
      <p>
        La base jurídica para el almacenamiento temporal de los datos y
        de los archivos de log es el Art. 6 apdo. 1 letra f RGPD. El
        almacenamiento temporal de la dirección IP es necesario para
        permitir la entrega del sitio web al equipo del usuario y para
        garantizar la seguridad informática. Para ello, la dirección IP
        debe permanecer almacenada durante la sesión.
      </p>

      <H3>3.4 Plazo de conservación</H3>
      <p>
        Los datos se suprimen tan pronto como dejan de ser necesarios
        para la finalidad de su recogida. En el caso de los datos
        recopilados para la provisión del sitio web, esto sucede al
        terminar la sesión correspondiente. Los archivos de log se
        suprimen tras un máximo de 14 días.
      </p>

      <H2>4. Cookies y gestión del consentimiento</H2>
      <p>
        Nuestra web utiliza cookies. Las cookies son pequeños archivos
        de texto que se almacenan en tu dispositivo. Distinguimos entre
        cookies técnicamente necesarias y aquellas que requieren tu
        consentimiento.
      </p>

      <H3>4.1 Cookies técnicamente necesarias</H3>
      <p>
        Estas cookies son imprescindibles para garantizar las funciones
        básicas de nuestra web (por ejemplo, preferencias de idioma,
        sesiones de inicio en la plataforma de aprendizaje{" "}
        <a href="https://schule.aprender-aleman.de">schule.aprender-aleman.de</a>).
        La base jurídica es el Art. 6 apdo. 1 letra f RGPD así como el
        § 25 apdo. 2 nº 2 TTDSG (ley alemana de telecomunicaciones y
        protección de datos).
      </p>

      <H3>4.2 Cookies y servicios sujetos a consentimiento</H3>
      <p>
        Otras cookies y servicios de terceros (Google Ads, otros
        servicios de seguimiento, contenidos incrustados) solo se
        activan tras tu consentimiento expreso conforme al Art. 6 apdo. 1
        letra a RGPD y al § 25 apdo. 1 TTDSG. En tu primera visita
        aparecerá un banner de cookies a través del cual podrás
        otorgar o rechazar tu consentimiento. Puedes retirarlo en
        cualquier momento con efecto futuro modificando los ajustes de
        cookies.
      </p>

      <H2>5. Procesamiento de pagos a través de Stripe</H2>

      <H3>5.1 Descripción</H3>
      <p>
        En nuestra web ofrecemos pagos a través del proveedor Stripe
        Payments Europe Ltd., 1 Grand Canal Street Lower, Grand Canal
        Dock, Dublín, Irlanda (en adelante "Stripe"). Si optas por pagar
        a través de Stripe, los datos de pago introducidos durante el
        proceso (por ejemplo, nombre, número de tarjeta, datos
        bancarios, dirección de email, dirección IP) se transmiten
        directamente a Stripe.
      </p>

      <H3>5.2 Finalidad y base jurídica</H3>
      <p>
        La transmisión se realiza para la ejecución del contrato
        conforme al Art. 6 apdo. 1 letra b RGPD. No tenemos influencia
        sobre los datos recabados por Stripe ni conocemos el contenido
        completo. Stripe puede utilizar adicionalmente los datos para
        realizar análisis estadísticos sobre la evolución de su
        negocio, optimizar sus sistemas de seguridad y para fines de
        marketing. Esto se realiza sobre la base del interés legítimo
        conforme al Art. 6 apdo. 1 letra f RGPD.
      </p>

      <H3>5.3 Transferencia a terceros países</H3>
      <p>
        Stripe puede transmitir datos personales a su sociedad matriz
        Stripe, Inc. en EE.UU. La transferencia se realiza sobre la
        base de Cláusulas Contractuales Tipo conforme al Art. 46 apdo. 2
        letra c RGPD y del marco EU-US Data Privacy Framework (Decisión
        de adecuación de la Comisión Europea de 10/07/2023).
      </p>

      <H3>5.4 Más información</H3>
      <p>
        Más información sobre el tratamiento de datos por Stripe en su
        política de privacidad:{" "}
        <a href="https://stripe.com/es/privacy" target="_blank" rel="noopener noreferrer">
          https://stripe.com/es/privacy
        </a>
      </p>

      <H2>6. Reserva de citas a través de Calendly</H2>

      <H3>6.1 Descripción</H3>
      <p>
        Para la concertación de citas utilizamos el servicio Calendly de
        Calendly LLC, 271 17th St NW, Suite 1000, Atlanta, Georgia
        30363, EE.UU. (en adelante "Calendly"). Cuando reservas una
        cita a través de nuestra oferta, los datos que introduces
        (nombre, dirección de email, franja horaria seleccionada y, en
        su caso, otros datos que facilites voluntariamente) se
        transmiten a Calendly y se almacenan allí.
      </p>

      <H3>6.2 Finalidad y base jurídica</H3>
      <p>
        El tratamiento se realiza para llevar a cabo medidas
        precontractuales y para la ejecución del contrato conforme al
        Art. 6 apdo. 1 letra b RGPD.
      </p>

      <H3>6.3 Transferencia a terceros países</H3>
      <p>
        Calendly procesa los datos en EE.UU. La transferencia se realiza
        sobre la base de Cláusulas Contractuales Tipo conforme al
        Art. 46 apdo. 2 letra c RGPD y del marco EU-US Data Privacy
        Framework.
      </p>

      <H3>6.4 Más información</H3>
      <p>
        Más información en la política de privacidad de Calendly:{" "}
        <a href="https://calendly.com/privacy" target="_blank" rel="noopener noreferrer">
          https://calendly.com/privacy
        </a>
      </p>

      <H2>7. Seguimiento de conversiones de Google Ads</H2>

      <H3>7.1 Descripción</H3>
      <p>
        Utilizamos el programa de publicidad online "Google Ads" y, en
        el marco de Google Ads, el seguimiento de conversiones. El
        proveedor es Google Ireland Limited, Gordon House, Barrow
        Street, Dublin 4, Irlanda (en adelante "Google"). Con la ayuda
        del seguimiento de conversiones de Google, tanto Google como
        nosotros podemos identificar qué acciones realiza el usuario
        después de hacer clic en un anuncio (por ejemplo, compra,
        registro).
      </p>

      <H3>7.2 Funcionamiento</H3>
      <p>
        Cuando haces clic en un anuncio mostrado por Google, se coloca
        una cookie de seguimiento de conversiones en tu dispositivo.
        Estas cookies pierden, por lo general, su validez tras 30 días,
        no sirven para la identificación personal y no contienen datos
        personales. Si visitas determinadas páginas de nuestra web y la
        cookie aún no ha caducado, Google y nosotros podemos reconocer
        que has hecho clic en el anuncio y has sido redirigido a esa
        página.
      </p>

      <H3>7.3 Finalidad y base jurídica</H3>
      <p>
        El almacenamiento de cookies por parte del seguimiento de
        conversiones de Google Ads y la evaluación de tu comportamiento
        de uso se realizan exclusivamente sobre la base de tu
        consentimiento expreso conforme al Art. 6 apdo. 1 letra a RGPD
        y al § 25 apdo. 1 TTDSG, que puedes otorgar o rechazar a través
        de nuestro banner de cookies. Puedes retirar tu consentimiento
        en cualquier momento con efecto futuro.
      </p>

      <H3>7.4 Transferencia a terceros países</H3>
      <p>
        Google puede transmitir datos personales a EE.UU. La
        transferencia se realiza sobre la base del marco EU-US Data
        Privacy Framework y, complementariamente, sobre la base de
        Cláusulas Contractuales Tipo.
      </p>

      <H3>7.5 Más información</H3>
      <p>
        Más información sobre Google Ads y el seguimiento de
        conversiones en la política de privacidad de Google:{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          https://policies.google.com/privacy
        </a>
      </p>

      <H2>8. Plataforma de aprendizaje schule.aprender-aleman.de</H2>

      <H3>8.1 Registro y datos de uso</H3>
      <p>
        En nuestra plataforma de aprendizaje{" "}
        <a href="https://schule.aprender-aleman.de">schule.aprender-aleman.de</a>
        {" "}existe la posibilidad de registrarse como alumno o como
        profesor. En el registro recopilamos los siguientes datos:
      </p>
      <Ul items={[
        <>Nombre</>,
        <>Dirección de email</>,
        <>Contraseña (almacenada cifrada)</>,
        <>Nivel de idioma y preferencias de aprendizaje (alumnos)</>,
        <>Datos de perfil y disponibilidad (profesores)</>,
      ]}/>
      <p>
        Durante el uso de la plataforma se almacenan, además, datos
        sobre cursos visitados, horas lectivas, tareas y progresos.
      </p>

      <H3>8.2 Finalidad y base jurídica</H3>
      <p>
        El tratamiento de estos datos se realiza para la prestación del
        servicio acordado contractualmente conforme al Art. 6 apdo. 1
        letra b RGPD.
      </p>

      <H3>8.3 Plazo de conservación</H3>
      <p>
        Los datos se almacenan durante la vigencia de tu cuenta de
        usuario. Tras la supresión de la cuenta, los datos se eliminan o
        anonimizan, salvo que existan obligaciones legales de
        conservación (en particular, obligaciones fiscales y mercantiles
        según el § 147 AO y el § 257 HGB, por lo general entre 6 y 10
        años).
      </p>

      <H2>9. Contacto por email</H2>
      <p>
        Cuando nos contactas por email ({" "}
        <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>),
        los datos que nos comunicas (dirección de email, nombre,
        contenido del mensaje) se almacenan para tramitar tu consulta.
        La base jurídica es el Art. 6 apdo. 1 letra f RGPD o, en su
        caso, el Art. 6 apdo. 1 letra b RGPD si la consulta tiene por
        objeto la celebración de un contrato.
      </p>
      <p>
        Los datos se suprimen en cuanto dejan de ser necesarios para la
        finalidad de su recogida y no existan obligaciones legales de
        conservación que se opongan a ello.
      </p>

      <H2>10. Derechos del interesado</H2>
      <p>
        Si se tratan datos personales tuyos, eres un interesado en el
        sentido del RGPD y te asisten los siguientes derechos frente al
        responsable:
      </p>

      <H3>10.1 Derecho de acceso (Art. 15 RGPD)</H3>
      <p>
        Puedes solicitarnos confirmación de si se están tratando datos
        personales que te conciernen. Si existe tal tratamiento, puedes
        solicitar información sobre los datos y las circunstancias del
        mismo.
      </p>

      <H3>10.2 Derecho de rectificación (Art. 16 RGPD)</H3>
      <p>
        Tienes derecho a solicitar la rectificación de los datos
        personales inexactos que te conciernan, así como su
        completación.
      </p>

      <H3>10.3 Derecho de supresión (Art. 17 RGPD)</H3>
      <p>
        Tienes derecho a solicitar que se supriman sin dilación
        indebida los datos personales que te conciernan, siempre que
        concurra alguno de los motivos previstos en el Art. 17 apdo. 1
        RGPD.
      </p>

      <H3>10.4 Derecho a la limitación del tratamiento (Art. 18 RGPD)</H3>
      <p>
        Tienes derecho a solicitar la limitación del tratamiento de tus
        datos personales cuando se cumplan los requisitos del
        Art. 18 RGPD.
      </p>

      <H3>10.5 Derecho a la portabilidad de los datos (Art. 20 RGPD)</H3>
      <p>
        Tienes derecho a recibir los datos personales que te conciernan
        en un formato estructurado, de uso común y lectura mecánica.
      </p>

      <H3>10.6 Derecho de oposición (Art. 21 RGPD)</H3>
      <p>
        Tienes derecho a oponerte, por motivos relacionados con tu
        situación particular, en cualquier momento al tratamiento de
        datos personales que te conciernan.
      </p>

      <H3>10.7 Derecho a retirar el consentimiento (Art. 7 apdo. 3 RGPD)</H3>
      <p>
        Tienes derecho a retirar tu declaración de consentimiento en
        materia de protección de datos en cualquier momento. La
        retirada del consentimiento no afecta a la licitud del
        tratamiento basado en dicho consentimiento previa a su
        retirada.
      </p>

      <H3>10.8 Derecho a presentar una reclamación ante una autoridad de control (Art. 77 RGPD)</H3>
      <p>
        Sin perjuicio de cualquier otro recurso administrativo o
        judicial, tienes derecho a presentar una reclamación ante una
        autoridad de control si consideras que el tratamiento de los
        datos personales que te conciernen infringe el RGPD.
      </p>
      <p>La autoridad de control competente para nosotros es:</p>
      <Block>
        Die Landesbeauftragte für den Datenschutz Niedersachsen<br />
        Prinzenstraße 5<br />
        30159 Hannover<br />
        Teléfono: +49 511 120-4500<br />
        Email: <a href="mailto:poststelle@lfd.niedersachsen.de">poststelle@lfd.niedersachsen.de</a>
      </Block>

      <H2>11. Cifrado SSL</H2>
      <p>
        Esta página utiliza, por motivos de seguridad y para proteger la
        transmisión de contenidos confidenciales, un cifrado SSL.
        Reconocerás una conexión cifrada porque la barra de direcciones
        del navegador cambia de "http://" a "https://" y por el icono
        del candado en la barra del navegador.
      </p>

      <H2>12. Vigencia y modificaciones de esta política</H2>
      <p>
        Esta política de privacidad está actualmente vigente y tiene
        fecha de mayo de 2026. Debido al desarrollo continuo de nuestra
        web y de nuestros servicios o por modificaciones legales o
        administrativas, puede ser necesario adaptar esta política de
        privacidad. La versión vigente puede consultarse e imprimirse
        en cualquier momento desde esta web.
      </p>

      <H2>13. Contacto</H2>
      <p>
        Para cualquier pregunta sobre la recopilación, tratamiento o
        uso de tus datos personales, así como para solicitar acceso,
        rectificación, bloqueo o supresión de datos o retirar
        consentimientos otorgados, contáctanos en:
      </p>
      <Block>
        Email: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>
      </Block>
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
      <p className="text-sm text-slate-500">Stand: Mai 2026</p>

      <H2>1. Verantwortlicher</H2>
      <p>
        Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO)
        und anderer nationaler Datenschutzgesetze sowie sonstiger
        datenschutzrechtlicher Bestimmungen ist:
      </p>
      <Block>
        <strong>Gelfis Horn</strong><br />
        Einzelunternehmer<br />
        Johann-Heinrich-Schröder-Straße<br />
        31832 Springe<br />
        Deutschland<br />
        <br />
        E-Mail: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>
      </Block>

      <H2>2. Allgemeines zur Datenverarbeitung</H2>

      <H3>2.1 Umfang der Verarbeitung</H3>
      <p>
        Wir erheben und verwenden personenbezogene Daten unserer Nutzer
        grundsätzlich nur, soweit dies zur Bereitstellung einer
        funktionsfähigen Website sowie unserer Inhalte und Leistungen
        erforderlich ist. Die Erhebung und Verwendung personenbezogener
        Daten unserer Nutzer erfolgt regelmäßig nur nach Einwilligung des
        Nutzers oder wenn eine vorherige Einholung einer Einwilligung aus
        tatsächlichen Gründen nicht möglich ist und die Verarbeitung der
        Daten durch gesetzliche Vorschriften gestattet ist.
      </p>

      <H3>2.2 Rechtsgrundlagen</H3>
      <p>
        Soweit wir für Verarbeitungsvorgänge personenbezogener Daten eine
        Einwilligung der betroffenen Person einholen, dient Art. 6 Abs. 1
        lit. a DSGVO als Rechtsgrundlage.
      </p>
      <p>
        Bei der Verarbeitung von personenbezogenen Daten, die zur
        Erfüllung eines Vertrages erforderlich ist, dient Art. 6 Abs. 1
        lit. b DSGVO als Rechtsgrundlage. Dies gilt auch für
        Verarbeitungsvorgänge, die zur Durchführung vorvertraglicher
        Maßnahmen erforderlich sind.
      </p>
      <p>
        Soweit eine Verarbeitung zur Wahrung eines berechtigten Interesses
        unseres Unternehmens oder eines Dritten erforderlich ist und die
        Interessen, Grundrechte und Grundfreiheiten des Betroffenen das
        erstgenannte Interesse nicht überwiegen, dient Art. 6 Abs. 1 lit. f
        DSGVO als Rechtsgrundlage.
      </p>

      <H3>2.3 Datenlöschung und Speicherdauer</H3>
      <p>
        Die personenbezogenen Daten der betroffenen Person werden gelöscht
        oder gesperrt, sobald der Zweck der Speicherung entfällt. Eine
        Speicherung kann darüber hinaus erfolgen, wenn dies durch den
        europäischen oder nationalen Gesetzgeber in unionsrechtlichen
        Verordnungen, Gesetzen oder sonstigen Vorschriften, denen der
        Verantwortliche unterliegt, vorgesehen wurde. Eine Sperrung oder
        Löschung der Daten erfolgt auch dann, wenn eine durch die
        genannten Normen vorgeschriebene Speicherfrist abläuft, es sei
        denn, dass eine Erforderlichkeit zur weiteren Speicherung der
        Daten für einen Vertragsabschluss oder eine Vertragserfüllung
        besteht.
      </p>

      <H2>3. Bereitstellung der Website und Erstellung von Logfiles</H2>

      <H3>3.1 Beschreibung und Umfang der Datenverarbeitung</H3>
      <p>
        Bei jedem Aufruf unserer Internetseite erfasst unser System
        automatisiert Daten und Informationen vom Computersystem des
        aufrufenden Rechners. Folgende Daten werden hierbei erhoben:
      </p>
      <Ul items={[
        <>IP-Adresse des Nutzers</>,
        <>Datum und Uhrzeit des Zugriffs</>,
        <>Browsertyp und verwendete Version</>,
        <>Betriebssystem des Nutzers</>,
        <>Referrer-URL (die zuvor besuchte Seite)</>,
        <>Aufgerufene Seiten und übertragene Datenmengen</>,
      ]}/>
      <p>
        Die Daten werden ebenfalls in den Logfiles unseres Systems
        gespeichert. Eine Speicherung dieser Daten zusammen mit anderen
        personenbezogenen Daten des Nutzers findet nicht statt.
      </p>

      <H3>3.2 Hosting</H3>
      <p>
        Wir hosten unsere Webseiten <a href="https://aprender-aleman.de">aprender-aleman.de</a>
        {" "}und <a href="https://schule.aprender-aleman.de">schule.aprender-aleman.de</a>
        {" "}bei der Hostinger International Ltd., 61 Lordou Vironos Street,
        6023 Larnaca, Zypern (nachfolgend „Hostinger"). Hostinger
        verarbeitet personenbezogene Daten ausschließlich in unserem
        Auftrag auf Grundlage eines Auftragsverarbeitungsvertrags gemäß
        Art. 28 DSGVO.
      </p>

      <H3>3.3 Rechtsgrundlage und Zweck</H3>
      <p>
        Rechtsgrundlage für die vorübergehende Speicherung der Daten und
        der Logfiles ist Art. 6 Abs. 1 lit. f DSGVO. Die vorübergehende
        Speicherung der IP-Adresse durch das System ist notwendig, um eine
        Auslieferung der Website an den Rechner des Nutzers zu ermöglichen
        sowie zur Gewährleistung der IT-Sicherheit. Hierfür muss die
        IP-Adresse des Nutzers für die Dauer der Sitzung gespeichert
        bleiben.
      </p>

      <H3>3.4 Speicherdauer</H3>
      <p>
        Die Daten werden gelöscht, sobald sie für die Erreichung des
        Zweckes ihrer Erhebung nicht mehr erforderlich sind. Im Falle der
        Erfassung der Daten zur Bereitstellung der Website ist dies der
        Fall, wenn die jeweilige Sitzung beendet ist. Logfiles werden nach
        maximal 14 Tagen gelöscht.
      </p>

      <H2>4. Cookies und Einwilligungsmanagement</H2>
      <p>
        Unsere Website verwendet Cookies. Cookies sind kleine Textdateien,
        die auf Ihrem Endgerät gespeichert werden. Wir unterscheiden
        zwischen technisch notwendigen Cookies und solchen, die Ihrer
        Einwilligung bedürfen.
      </p>

      <H3>4.1 Technisch notwendige Cookies</H3>
      <p>
        Diese Cookies sind erforderlich, um die Grundfunktionen unserer
        Website zu gewährleisten (z. B. Spracheinstellungen,
        Login-Sitzungen auf der Lernplattform{" "}
        <a href="https://schule.aprender-aleman.de">schule.aprender-aleman.de</a>).
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO sowie § 25 Abs. 2
        Nr. 2 TTDSG.
      </p>

      <H3>4.2 Einwilligungspflichtige Cookies und Dienste</H3>
      <p>
        Andere Cookies und Drittanbieterdienste (Google Ads, weitere
        Tracking-Dienste, eingebettete Inhalte) werden nur nach
        ausdrücklicher Einwilligung gemäß Art. 6 Abs. 1 lit. a DSGVO und
        § 25 Abs. 1 TTDSG aktiviert. Beim ersten Besuch unserer Website
        erscheint ein Cookie-Banner, über das Sie Ihre Einwilligung
        erteilen oder verweigern können. Sie können Ihre Einwilligung
        jederzeit mit Wirkung für die Zukunft widerrufen, indem Sie die
        Cookie-Einstellungen ändern.
      </p>

      <H2>5. Zahlungsabwicklung über Stripe</H2>

      <H3>5.1 Beschreibung</H3>
      <p>
        Auf unserer Webseite bieten wir Zahlungen über den Anbieter Stripe
        Payments Europe Ltd., 1 Grand Canal Street Lower, Grand Canal
        Dock, Dublin, Irland (nachfolgend „Stripe") an. Wenn Sie sich für
        eine Zahlung über Stripe entscheiden, werden die im Rahmen des
        Bezahlvorgangs eingegebenen Zahlungsdaten (z. B. Name, Kartennummer,
        Bankverbindung, E-Mail-Adresse, IP-Adresse) direkt an Stripe
        übermittelt.
      </p>

      <H3>5.2 Zweck und Rechtsgrundlage</H3>
      <p>
        Die Übermittlung erfolgt zur Vertragsabwicklung gemäß Art. 6
        Abs. 1 lit. b DSGVO. Wir haben keinen Einfluss auf die durch
        Stripe erhobenen Daten und auch keine Kenntnis vom vollständigen
        Inhalt. Stripe kann die Daten zudem nutzen, um statistische
        Auswertungen zur Geschäftsentwicklung zu erstellen, ihre
        Sicherheitssysteme zu optimieren und Marketingzwecke. Dies erfolgt
        auf Grundlage des berechtigten Interesses gemäß Art. 6 Abs. 1
        lit. f DSGVO.
      </p>

      <H3>5.3 Datenübermittlung in Drittländer</H3>
      <p>
        Stripe kann personenbezogene Daten an die Muttergesellschaft
        Stripe, Inc. in den USA übermitteln. Die Übermittlung erfolgt auf
        Grundlage von Standardvertragsklauseln gemäß Art. 46 Abs. 2 lit. c
        DSGVO sowie auf Grundlage des EU-US Data Privacy Framework
        (Adequacy Decision der EU-Kommission vom 10.07.2023).
      </p>

      <H3>5.4 Weitere Informationen</H3>
      <p>
        Weitere Informationen zur Datenverarbeitung durch Stripe finden
        Sie in der Datenschutzerklärung von Stripe unter:{" "}
        <a href="https://stripe.com/de/privacy" target="_blank" rel="noopener noreferrer">
          https://stripe.com/de/privacy
        </a>
      </p>

      <H2>6. Terminbuchung über Calendly</H2>

      <H3>6.1 Beschreibung</H3>
      <p>
        Wir nutzen für die Terminvereinbarung den Dienst Calendly der
        Calendly LLC, 271 17th St NW, Suite 1000, Atlanta, Georgia 30363,
        USA (nachfolgend „Calendly"). Wenn Sie über unser Angebot einen
        Termin buchen, werden die von Ihnen eingegebenen Daten (Name,
        E-Mail-Adresse, ausgewählter Zeitslot, gegebenenfalls weitere von
        Ihnen freiwillig angegebene Informationen) an Calendly übermittelt
        und dort gespeichert.
      </p>

      <H3>6.2 Zweck und Rechtsgrundlage</H3>
      <p>
        Die Verarbeitung erfolgt zur Durchführung vorvertraglicher
        Maßnahmen sowie zur Vertragsabwicklung gemäß Art. 6 Abs. 1 lit. b
        DSGVO.
      </p>

      <H3>6.3 Datenübermittlung in Drittländer</H3>
      <p>
        Calendly verarbeitet die Daten in den USA. Die Übermittlung
        erfolgt auf Grundlage von Standardvertragsklauseln gemäß Art. 46
        Abs. 2 lit. c DSGVO sowie auf Grundlage des EU-US Data Privacy
        Framework.
      </p>

      <H3>6.4 Weitere Informationen</H3>
      <p>
        Weitere Informationen finden Sie in der Datenschutzerklärung von
        Calendly unter:{" "}
        <a href="https://calendly.com/privacy" target="_blank" rel="noopener noreferrer">
          https://calendly.com/privacy
        </a>
      </p>

      <H2>7. Google Ads Conversion Tracking</H2>

      <H3>7.1 Beschreibung</H3>
      <p>
        Wir nutzen das Online-Werbeprogramm „Google Ads" und im Rahmen
        von Google Ads das Conversion-Tracking. Anbieter ist die Google
        Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland
        (nachfolgend „Google"). Mit Hilfe von Google Conversion-Tracking
        können Google und wir erkennen, welche Aktionen der Nutzer nach
        dem Klick auf eine geschaltete Anzeige durchführt (z. B. Kauf,
        Anmeldung).
      </p>

      <H3>7.2 Funktionsweise</H3>
      <p>
        Wenn Sie auf eine von Google geschaltete Anzeige klicken, wird ein
        Cookie für das Conversion-Tracking auf Ihrem Endgerät abgelegt.
        Diese Cookies verlieren in der Regel nach 30 Tagen ihre Gültigkeit,
        dienen nicht der persönlichen Identifizierung und enthalten keine
        personenbezogenen Daten. Besuchen Sie bestimmte Seiten unserer
        Website und ist das Cookie noch nicht abgelaufen, können Google
        und wir erkennen, dass Sie auf die Anzeige geklickt haben und zu
        dieser Seite weitergeleitet wurden.
      </p>

      <H3>7.3 Zweck und Rechtsgrundlage</H3>
      <p>
        Die Speicherung von Cookies durch Google Ads Conversion Tracking
        sowie die Auswertung Ihres Nutzerverhaltens erfolgen ausschließlich
        auf Grundlage Ihrer ausdrücklichen Einwilligung gemäß Art. 6
        Abs. 1 lit. a DSGVO und § 25 Abs. 1 TTDSG, die Sie über unser
        Cookie-Banner erteilen oder verweigern können. Sie können Ihre
        Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.
      </p>

      <H3>7.4 Datenübermittlung in Drittländer</H3>
      <p>
        Google kann personenbezogene Daten in die USA übermitteln. Die
        Übermittlung erfolgt auf Grundlage des EU-US Data Privacy
        Framework sowie ergänzend auf Grundlage von
        Standardvertragsklauseln.
      </p>

      <H3>7.5 Weitere Informationen</H3>
      <p>
        Mehr Informationen zu Google Ads und Conversion-Tracking finden
        Sie in den Datenschutzbestimmungen von Google:{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          https://policies.google.com/privacy
        </a>
      </p>

      <H2>8. Lernplattform schule.aprender-aleman.de</H2>

      <H3>8.1 Registrierung und Nutzungsdaten</H3>
      <p>
        Auf unserer Lernplattform{" "}
        <a href="https://schule.aprender-aleman.de">schule.aprender-aleman.de</a>
        {" "}besteht die Möglichkeit, sich als Schüler oder Lehrkraft zu
        registrieren. Bei der Registrierung erheben wir folgende Daten:
      </p>
      <Ul items={[
        <>Name</>,
        <>E-Mail-Adresse</>,
        <>Passwort (verschlüsselt gespeichert)</>,
        <>Sprachniveau und Lernpräferenzen (bei Schülern)</>,
        <>Profildaten und Verfügbarkeit (bei Lehrkräften)</>,
      ]}/>
      <p>
        Während der Nutzung der Plattform werden zudem Daten über besuchte
        Kurse, Unterrichtsstunden, Aufgaben und Fortschritte gespeichert.
      </p>

      <H3>8.2 Zweck und Rechtsgrundlage</H3>
      <p>
        Die Verarbeitung dieser Daten erfolgt zur Erbringung der
        vertraglich vereinbarten Leistung gemäß Art. 6 Abs. 1 lit. b
        DSGVO.
      </p>

      <H3>8.3 Speicherdauer</H3>
      <p>
        Die Daten werden für die Dauer Ihres Nutzerkontos gespeichert.
        Nach Löschung des Kontos werden die Daten gelöscht oder
        anonymisiert, sofern keine gesetzlichen Aufbewahrungspflichten
        entgegenstehen (insbesondere steuer- und handelsrechtliche
        Pflichten gemäß § 147 AO und § 257 HGB, in der Regel 6 bis 10
        Jahre).
      </p>

      <H2>9. Kontaktaufnahme per E-Mail</H2>
      <p>
        Wenn Sie uns per E-Mail kontaktieren ({" "}
        <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>),
        werden die von Ihnen mitgeteilten Daten (E-Mail-Adresse, Name,
        Inhalt der Nachricht) zur Bearbeitung Ihrer Anfrage gespeichert.
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO bzw. Art. 6 Abs. 1
        lit. b DSGVO, sofern die Anfrage auf den Abschluss eines Vertrages
        gerichtet ist.
      </p>
      <p>
        Die Daten werden gelöscht, sobald sie für die Zweckerreichung
        nicht mehr erforderlich sind und keine gesetzlichen
        Aufbewahrungspflichten entgegenstehen.
      </p>

      <H2>10. Rechte der betroffenen Person</H2>
      <p>
        Werden personenbezogene Daten von Ihnen verarbeitet, sind Sie
        Betroffener im Sinne der DSGVO und es stehen Ihnen folgende Rechte
        gegenüber dem Verantwortlichen zu:
      </p>

      <H3>10.1 Auskunftsrecht (Art. 15 DSGVO)</H3>
      <p>
        Sie können von uns eine Bestätigung darüber verlangen, ob Sie
        betreffende personenbezogene Daten von uns verarbeitet werden.
        Liegt eine solche Verarbeitung vor, können Sie Auskunft über die
        Daten und die Umstände ihrer Verarbeitung verlangen.
      </p>

      <H3>10.2 Recht auf Berichtigung (Art. 16 DSGVO)</H3>
      <p>
        Sie haben das Recht, die Berichtigung unrichtiger Sie betreffender
        personenbezogener Daten zu verlangen sowie deren Vervollständigung.
      </p>

      <H3>10.3 Recht auf Löschung (Art. 17 DSGVO)</H3>
      <p>
        Sie haben das Recht zu verlangen, dass Sie betreffende
        personenbezogene Daten unverzüglich gelöscht werden, sofern einer
        der Gründe des Art. 17 Abs. 1 DSGVO vorliegt.
      </p>

      <H3>10.4 Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</H3>
      <p>
        Sie haben das Recht, die Einschränkung der Verarbeitung Ihrer
        personenbezogenen Daten zu verlangen, wenn die Voraussetzungen des
        Art. 18 DSGVO vorliegen.
      </p>

      <H3>10.5 Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</H3>
      <p>
        Sie haben das Recht, die Sie betreffenden personenbezogenen Daten
        in einem strukturierten, gängigen und maschinenlesbaren Format zu
        erhalten.
      </p>

      <H3>10.6 Widerspruchsrecht (Art. 21 DSGVO)</H3>
      <p>
        Sie haben das Recht, aus Gründen, die sich aus Ihrer besonderen
        Situation ergeben, jederzeit gegen die Verarbeitung Sie
        betreffender personenbezogener Daten Widerspruch einzulegen.
      </p>

      <H3>10.7 Recht auf Widerruf der datenschutzrechtlichen Einwilligungserklärung (Art. 7 Abs. 3 DSGVO)</H3>
      <p>
        Sie haben das Recht, Ihre datenschutzrechtliche
        Einwilligungserklärung jederzeit zu widerrufen. Durch den Widerruf
        der Einwilligung wird die Rechtmäßigkeit der aufgrund der
        Einwilligung bis zum Widerruf erfolgten Verarbeitung nicht
        berührt.
      </p>

      <H3>10.8 Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO)</H3>
      <p>
        Unbeschadet eines anderweitigen verwaltungsrechtlichen oder
        gerichtlichen Rechtsbehelfs steht Ihnen das Recht auf Beschwerde
        bei einer Aufsichtsbehörde zu, wenn Sie der Ansicht sind, dass die
        Verarbeitung der Sie betreffenden personenbezogenen Daten gegen
        die DSGVO verstößt.
      </p>
      <p>Die für uns zuständige Aufsichtsbehörde ist:</p>
      <Block>
        Die Landesbeauftragte für den Datenschutz Niedersachsen<br />
        Prinzenstraße 5<br />
        30159 Hannover<br />
        Telefon: +49 511 120-4500<br />
        E-Mail: <a href="mailto:poststelle@lfd.niedersachsen.de">poststelle@lfd.niedersachsen.de</a>
      </Block>

      <H2>11. SSL-Verschlüsselung</H2>
      <p>
        Diese Seite nutzt aus Gründen der Sicherheit und zum Schutz der
        Übertragung vertraulicher Inhalte eine SSL-Verschlüsselung. Eine
        verschlüsselte Verbindung erkennen Sie daran, dass die Adresszeile
        des Browsers von „http://" auf „https://" wechselt und an dem
        Schloss-Symbol in Ihrer Browserzeile.
      </p>

      <H2>12. Aktualität und Änderung dieser Datenschutzerklärung</H2>
      <p>
        Diese Datenschutzerklärung ist aktuell gültig und hat den Stand
        Mai 2026. Durch die Weiterentwicklung unserer Website und Angebote
        oder aufgrund geänderter gesetzlicher beziehungsweise behördlicher
        Vorgaben kann es notwendig werden, diese Datenschutzerklärung zu
        ändern. Die jeweils aktuelle Datenschutzerklärung kann jederzeit
        auf dieser Webseite eingesehen und ausgedruckt werden.
      </p>

      <H2>13. Kontakt</H2>
      <p>
        Bei Fragen zur Erhebung, Verarbeitung oder Nutzung Ihrer
        personenbezogenen Daten, bei Auskünften, Berichtigung, Sperrung
        oder Löschung von Daten sowie Widerruf erteilter Einwilligungen
        wenden Sie sich bitte an:
      </p>
      <Block>
        E-Mail: <a href="mailto:info@aprender-aleman.de">info@aprender-aleman.de</a>
      </Block>
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
