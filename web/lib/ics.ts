/**
 * Genera un archivo .ics (iCalendar) inline para adjuntar al email
 * de confirmación. Cuando el lead lo abre, su cliente de mail (Gmail,
 * Outlook, Apple Mail) le ofrece "Añadir al calendario" con un click.
 *
 * Formato: RFC 5545. Sólo lo justo para que funcione como invitación
 * de un evento único. SIN VALARM (recordatorios) por decisión expresa
 * de Gelfis — solo la invitación, los recordatorios viven en nuestro
 * propio sistema (email + WhatsApp).
 *
 * Notas de compatibilidad:
 *   - Líneas terminadas en CRLF (\r\n) — algunos clientes son
 *     estrictos.
 *   - Sin folding manual (max 75 chars/línea): aceptado por todos
 *     los clientes modernos. Si en el futuro hay alguno picky lo
 *     metemos.
 *   - DTSTAMP en UTC con sufijo "Z".
 *   - DTSTART/DTEND con TZID=Europe/Berlin para que el lead vea la
 *     hora en su zona local automáticamente.
 *   - Una sola VTIMEZONE para Europe/Berlin con la regla DST que
 *     aplica desde 1996 (hasta nuevo aviso de la UE).
 */

export type IcsTrialArgs = {
  uid:           string;          // identificador único del evento — usa class.id
  startIso:      string;          // ISO con offset
  durationMin:   number;
  summary:       string;          // título del evento (ya formateado)
  description:   string;          // cuerpo del invite
  organizerName: string;          // p.ej. "Gelfis Horn"
  organizerEmail: string;         // p.ej. "info@aprender-aleman.de"
  attendeeName?:  string;         // nombre del lead (para que sea cita y no anuncio)
  attendeeEmail?: string;
  location?:     string;          // URL del aula virtual
};

export function buildTrialIcs(args: IcsTrialArgs): string {
  const start = new Date(args.startIso);
  const end   = new Date(start.getTime() + args.durationMin * 60_000);
  const stamp = new Date();

  const fmtUtc   = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const fmtLocal = (d: Date) => {
    // YYYYMMDDTHHmmss en Europe/Berlin (sin Z porque va con TZID).
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit",  minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
    return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
  };

  const escape = (s: string) =>
    (s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aprender-Aleman.de//Trial Class//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:STANDARD",
    "DTSTART:19961027T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19810329T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${args.uid}@aprender-aleman.de`,
    `DTSTAMP:${fmtUtc(stamp)}`,
    `DTSTART;TZID=Europe/Berlin:${fmtLocal(start)}`,
    `DTEND;TZID=Europe/Berlin:${fmtLocal(end)}`,
    `SUMMARY:${escape(args.summary)}`,
    `DESCRIPTION:${escape(args.description)}`,
    `ORGANIZER;CN=${escape(args.organizerName)}:mailto:${args.organizerEmail}`,
  ];

  if (args.attendeeEmail) {
    const cn = args.attendeeName ?? args.attendeeEmail;
    lines.push(
      `ATTENDEE;CN=${escape(cn)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${args.attendeeEmail}`,
    );
  }

  if (args.location) lines.push(`LOCATION:${escape(args.location)}`);

  lines.push(
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    // SIN VALARM por decisión de Gelfis — solo invitación, no notifica.
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.join("\r\n") + "\r\n";
}
