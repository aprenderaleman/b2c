"use client";

/**
 * Pre-baked wa.me quick-action panel for /admin/leads/[id].
 *
 * Each button opens WhatsApp Web/Mobile with a templated message
 * pre-filled — Gelfis hits "Send" from his own WhatsApp, bypassing
 * the Evolution → agents pipeline entirely. This is the manual
 * recovery path used when:
 *   - Evolution session is disconnected (503s on outbound).
 *   - Inbound webhook is down (Stiv "didn't see" a reply).
 *   - We just want a personal-feeling touch.
 *
 * No emojis on the body — past wa.me links rendered emojis with
 * "load error" boxes on some clients (Windows fonts, older Chrome
 * builds). ASCII-safe makes it bulletproof.
 *
 * The panel only renders if the lead has a phone on file.
 */

type Trial = {
  scheduledAt: string | null;     // ISO
  shortCode:   string | null;
};

type Props = {
  leadName:     string;
  phoneE164:    string;
  language:     "es" | "de";
  trial:        Trial | null;
};

const WA_BASE = "https://wa.me/";

function fmtBerlin(iso: string, lang: "es" | "de"): string {
  return new Date(iso).toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  }) + (lang === "de" ? " (Berlin)" : " (Berlín)");
}

function url(phone: string, text: string): string {
  return WA_BASE + phone.replace(/\D/g, "") + "?text=" + encodeURIComponent(text);
}

export function WaQuickActions({ leadName, phoneE164, language, trial }: Props) {
  const first = (leadName || "").split(/\s+/)[0] || leadName || "";
  const isDe  = language === "de";

  const trialUrl  = trial?.shortCode ? `https://b2c.aprender-aleman.de/c/${trial.shortCode}` : null;
  const trialWhen = trial?.scheduledAt ? fmtBerlin(trial.scheduledAt, language) : null;
  // Time-only ("19:00") for the same-day reminder. Computed only if
  // we actually have a scheduled trial — eager evaluation against a
  // null `trial` was crashing the whole admin page (TypeError: cannot
  // read 'scheduledAt' of null) for any lead without a class.
  const trialTimeOnly = trial?.scheduledAt
    ? new Date(trial.scheduledAt).toLocaleTimeString(
        isDe ? "de-DE" : "es-ES",
        { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" },
      )
    : null;

  const templates: Array<{ label: string; text: string }> = [];

  if (trialUrl && trialWhen) {
    templates.push({
      label: isDe ? "Probestunde bestätigen"               : "Confirmar clase de prueba",
      text:  isDe
        ? `Hallo ${first}! Hier nochmal die Bestätigung deiner kostenlosen Deutsch-Probestunde: ${trialWhen}.\n\nDein persönlicher Link (1 Klick, kein Passwort):\n${trialUrl}\n\nWichtig: Beim Klick fragt dein Browser nach Mikrofon- und Kamerazugriff. Bitte auf "Erlauben" klicken — sonst kann ich dich nicht hoeren oder sehen.\n\nKannst du mir mit "Ja" bestaetigen, dass du dabei bist?\n\n— Stiv | Aprender-Aleman.de`
        : `Hola ${first}! Te confirmo tu clase de prueba gratis de aleman: ${trialWhen}.\n\nTu enlace personal (1 clic, sin contrasena):\n${trialUrl}\n\nImportante: al abrirlo el navegador te pedira permiso para microfono y camara. Pulsa "Permitir" — si no, no podre oirte ni verte.\n\nMe confirmas con un "Si" que asistiras?\n\n— Stiv | Aprender-Aleman.de`,
    });
  }

  if (trialUrl && trialTimeOnly) {
    templates.push({
      label: isDe ? "Erinnerung: Stunde heute"             : "Recordatorio: clase hoy",
      text:  isDe
        ? `Hallo ${first}! Kurze Erinnerung: deine Probestunde ist HEUTE um ${trialTimeOnly} (Berlin).\n\nLink: ${trialUrl}\n\nTipp: erlaube Mikrofon + Kamera, wenn der Browser fragt.\n\nBis gleich!\n\n— Stiv | Aprender-Aleman.de`
        : `Hola ${first}! Recordatorio: tu clase de prueba es HOY a las ${trialTimeOnly} (Berlin).\n\nLink: ${trialUrl}\n\nDato: cuando el navegador te pida permiso para microfono y camara, pulsa "Permitir".\n\nNos vemos!\n\n— Stiv | Aprender-Aleman.de`,
    });
  }

  templates.push({
    label: isDe ? "Hat meine Nachricht angekommen?" : "¿Llegó mi mensaje?",
    text:  isDe
      ? `Hallo ${first}, kurze Frage: ist meine letzte Nachricht bei dir angekommen? Wir hatten eine technische Stoerung mit WhatsApp. Falls du noch antworten moechtest, schreibe mir gerne.\n\n— Stiv | Aprender-Aleman.de`
      : `Hola ${first}, pregunta rapida: te llego mi ultimo mensaje? Tuvimos un fallo tecnico con WhatsApp. Si quieres responderme, dime.\n\n— Stiv | Aprender-Aleman.de`,
  });

  templates.push({
    label: isDe ? "Reagendar"                            : "Reagendar la clase",
    text:  isDe
      ? `Hallo ${first}! Wenn du die Probestunde verschieben moechtest, kannst du hier in 1 Minute einen neuen Termin auswaehlen:\nhttps://b2c.aprender-aleman.de/agendar\n\n— Stiv | Aprender-Aleman.de`
      : `Hola ${first}! Si quieres mover la clase de prueba a otro dia, aqui puedes elegir un nuevo horario en 1 minuto:\nhttps://b2c.aprender-aleman.de/agendar\n\n— Stiv | Aprender-Aleman.de`,
  });

  templates.push({
    label: isDe ? "Es ist eine Videokonferenz"           : "Es videollamada (FAQ)",
    text:  isDe
      ? `Hallo ${first}! Ja, die Probestunde ist eine Videokonferenz, 100% online — wir nutzen unser eigenes Klassenzimmer (kein Zoom oder Meet). Du klickst einfach den Link, dein Browser fragt nach Kamera und Mikrofon, du erlaubst es, und wir sehen uns.\n\n— Stiv | Aprender-Aleman.de`
      : `Hola ${first}! Si, la clase de prueba es una videollamada, 100% online — usamos nuestra propia aula virtual (no Zoom ni Meet). Haces clic al enlace, tu navegador te pide camara y microfono, das permitir, y nos vemos.\n\n— Stiv | Aprender-Aleman.de`,
  });

  return (
    <details className="rounded-3xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-emerald-800 dark:text-emerald-200 select-none">
        Acciones rápidas — abrir WhatsApp con plantilla
      </summary>
      <p className="mt-2 text-xs text-emerald-700/70 dark:text-emerald-300/70">
        Cada enlace abre tu WhatsApp Web/móvil con el mensaje pre-cargado.
        Tú envías desde tu cuenta personal — útil cuando Stiv está caído o
        quieres dar un toque personal. ASCII puro, sin emojis problemáticos.
      </p>
      <ul className="mt-3 grid gap-2">
        {templates.map(t => (
          <li key={t.label}>
            <a
              href={url(phoneE164, t.text)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/30 px-3.5 py-2.5 text-sm font-medium text-emerald-800 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
            >
              <span>{t.label}</span>
              <span className="text-xs opacity-60">→ wa.me</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
