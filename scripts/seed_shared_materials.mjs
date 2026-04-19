#!/usr/bin/env node
/**
 * Seed `shared_materials` with the Aprender-Aleman.de Gamma curriculum.
 * Source: the official Google Doc maintained by Gelfis (88 Gamma decks
 * across A1, A2, B1, B2). Idempotent — uses the unique (level, gamma_url)
 * index we added in migration 027.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __d = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__d, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const G = (slug) => `https://gamma.app/docs/${slug}?mode=doc`;

/** shape: { level, module_name, lesson_number, title, subtitle, gamma_url, is_summary } */
const MATERIALS = [
  // ══════════════════════════════════════════════════════════════════════════
  // A1 — 22 lessons
  // ══════════════════════════════════════════════════════════════════════════
  { level: "A1", lesson_number: 1,  title: "Hallo! Ich bin…",                           gamma_url: G("Lektion-1-Hallo-Ich-bin-hk51yij7oswrhgo") },
  { level: "A1", lesson_number: 2,  title: "Mein Beruf & Zahlen",                       gamma_url: G("Lektion-2-Mein-Beruf-Zahlen-o3tumxab4cbkjwp") },
  { level: "A1", lesson_number: 3,  title: "Familie und Sprachen",                      gamma_url: G("Lektion-3-Familie-und-Sprachen-j9jhamnopuhe5or") },
  { level: "A1", lesson_number: 4,  title: "Das ist ein Tisch",                         gamma_url: G("Lektion-4-Das-ist-ein-Tisch-sdwxik8c7neaecp") },
  { level: "A1", lesson_number: 5,  title: "Produkte und Technik",                      gamma_url: G("Lektion-5-Produkte-und-Technik-mp3eyi006gbtr0l") },
  { level: "A1", lesson_number: 6,  title: "Im Büro",                  subtitle: "Der Akkusativ", gamma_url: G("Lektion-6-Im-Buro-Der-Akkusativ-szp5ztglhk2emli") },
  { level: "A1", lesson_number: 7,  title: "Hobbys",                   subtitle: "können",        gamma_url: G("Lektion-7-Hobbys-konnen-l7psrhufr0avvpx") },
  { level: "A1", lesson_number: 8,  title: "Verabredungen & Zeit",                      gamma_url: G("Lektion-8-Verabredungen-Zeit-cwtsws4r70jpodk") },
  { level: "A1", lesson_number: 9,  title: "Unterwegs — Reisen und Verkehr",            gamma_url: G("Lektion-10-Unterwegs-Reisen-und-Verkehr-6n93sk826q486sp") },
  { level: "A1", lesson_number: 10, title: "Mein Tag — Alltag und Uhrzeit",             gamma_url: G("Lektion-11-Mein-Tag-Alltag-und-Uhrzeit-jmhwp68g3qx6ivp") },
  { level: "A1", lesson_number: 11, title: "Das hast du toll gemacht!",                 gamma_url: G("Lektion-12-Das-hast-du-toll-gemacht-23fruateo1hnhud") },
  { level: "A1", lesson_number: 12, title: "Mein Kopf tut weh!",       subtitle: "Gesundheit & Imperativ", gamma_url: G("Lektion-13-Mein-Kopf-tut-weh-Gesundheit-Imperativ-ly6dokk8fnza56e") },
  { level: "A1", lesson_number: 13, title: "Hier ist mein Wohnzimmer",                  gamma_url: G("Lektion-14-Hier-ist-mein-Wohnzimmer-r1ik5y7flblo8ce") },
  { level: "A1", lesson_number: 14, title: "In der Stadt unterwegs",                    gamma_url: G("Lektion-15-In-der-Stadt-unterwegs-yu2omatrx44xl7i") },
  { level: "A1", lesson_number: 15, title: "Was ziehst du an?",        subtitle: "Kleidung & Komparativ",  gamma_url: G("Lektion-17-Was-ziehst-du-an-fbj43mveonc0e9v") },
  { level: "A1", lesson_number: 16, title: "Viel Glück!",              subtitle: "Feste & Dativ-Ergänzung", gamma_url: G("Lektion-18-Viel-Gluck-k9dgpga7t85rpc6") },
  { level: "A1", lesson_number: 17, title: "Früher und heute",         subtitle: "Post & Präteritum",       gamma_url: G("Lektion-19-Fruher-und-heute-Post-Prateritum-m6pm4srqp8gaw0x") },
  { level: "A1", lesson_number: 18, title: "Fragen — Verneinung — Konnektoren",         subtitle: "und, aber, oder, denn", gamma_url: G("Klasse-Fragen-Verneinung-Konnektoren-und-aber-oder-denn-i9iuu9dft076nfj") },
  { level: "A1", lesson_number: 19, title: "Modalverben im Präsens",   subtitle: "Fragen, Verneinung y Konnektoren", gamma_url: G("Modalverben-im-Prasens-mit-Fragen-Verneinung-und-Konnektoren-5d6zrnftn6000mk") },
  { level: "A1", lesson_number: 20, title: "Der Akkusativ im Deutschen",               gamma_url: "https://gamma.app/docs/Klasse-Der-Akkusativ-im-Deutschen-rvnnmout8d40jtf" },
  { level: "A1", lesson_number: 21, title: "Der Dativ im Deutschen",                    gamma_url: G("Der-Dativ-im-Deutschen-mktaczkea186uu3") },
  { level: "A1", lesson_number: 22, title: "Pläne für die Zukunft",    subtitle: "Reisen & werden",         gamma_url: G("Lektion-22-Plane-fur-die-Zukunft-Reisen-werden-l8ztwiw2aqpy77x") },

  // ══════════════════════════════════════════════════════════════════════════
  // A2 — 23 lessons + 1 summary
  // ══════════════════════════════════════════════════════════════════════════
  { level: "A2", lesson_number: 1,  title: "Berufe und Alltag",         subtitle: "Vertiefung",              gamma_url: G("Lektion-1-Berufe-und-Alltag-Vertiefung-jv8fin3jb6zlru6") },
  { level: "A2", lesson_number: 2,  title: "Familie & Beziehungen",     subtitle: "Reflexivverben",          gamma_url: G("Lektion-2-Familie-Beziehungen-Reflexivverben-7aggvukil3ano80") },
  { level: "A2", lesson_number: 3,  title: "Unterwegs",                                                      gamma_url: G("Lektion-3-Unterwegs-40kc2p0ygj5am5i") },
  { level: "A2", lesson_number: 4,  title: "Eine schöne Wohnung",                                            gamma_url: G("Lektion-4-Eine-schone-Wohnung-oyl0y81gdimx74p") },
  { level: "A2", lesson_number: 5,  title: "Was ist passiert?",         subtitle: "Unfälle & Präpositionalobjekte", gamma_url: G("Lektion-5-Was-ist-passiert-Unfalle-Prapositionalobjekte-9q4p0nx4y7no5cg") },
  { level: "A2", lesson_number: 6,  title: "Einladung zum Essen",       subtitle: "dass & wenn",             gamma_url: G("Lektion-6-Einladung-zum-Essen-dass-wenn-fswpnjrlp5fdvu1") },
  { level: "A2", lesson_number: 7,  title: "Technik und Medien",                                             gamma_url: G("Lektion-7-Technik-und-Medien-fhbx7nkh7zbf0nn") },
  { level: "A2", lesson_number: 8,  title: "Sport und Fitness",         subtitle: "Indirekte Fragen mit ob", gamma_url: G("Lektion-8-Sport-und-Fitness-Indirekte-Fragen-mit-ob-mm7qs9761cn2xxy") },
  { level: "A2", lesson_number: 9,  title: "Bildung und Karriere",      subtitle: "Das Präteritum",          gamma_url: G("Lektion-9-Bildung-und-Karriere-Das-Prateritum-za7r6prfqfa9awi") },
  { level: "A2", lesson_number: 10, title: "Einkaufen und Konsum",      subtitle: "Komparativ & Superlativ", gamma_url: G("Lektion-10-Einkaufen-und-Konsum-Komparativ-Superlativ-uesix0vt1gdvh5a") },
  { level: "A2", lesson_number: 11, title: "Wer hilft mir?",                                                 gamma_url: G("Lektion-11-Wer-hilft-mir-r5tmzuv7bumnsy5") },
  { level: "A2", lesson_number: 12, title: "Meine Träume",              subtitle: "Konjunktiv II",           gamma_url: G("Lektion-12-Meine-Traume-Konjunktiv-II-xuzzlwunverr9ex") },
  { level: "A2", lesson_number: 13, title: "Unsere Umwelt",                                                  gamma_url: G("Lektion-13-Unsere-Umwelt-4no6jvwh9zn93xm") },
  { level: "A2", lesson_number: 14, title: "Gute Nachbarschaft",                                             gamma_url: G("Lektion-14-Gute-Nachbarschaft-g8isinsgch66i2j") },
  { level: "A2", lesson_number: 15, title: "Stadtgeschichte",           subtitle: "Lokale Wechselpräpositionen", gamma_url: G("Lektion-15-Stadtgeschichte-Lokale-Wechselprapositionen-9qwob7r55a2ubi6") },
  { level: "A2", lesson_number: 16, title: "Nachrichten & Medien",                                           gamma_url: G("Lektion-16-Nachrichten-Medien-qfk6ywaqnn92ph1") },
  { level: "A2", lesson_number: 17, title: "Politik & Mitbestimmung",                                        gamma_url: G("Lektion-17-Politik-Mitbestimmung-fy6aro8sbhu9588") },
  { level: "A2", lesson_number: 18, title: "Jung und Alt",                                                   gamma_url: G("Lektion-18-Jung-und-Alt-969x7beeisxnqp1") },
  { level: "A2", lesson_number: 19, title: "Ein Leben lang lernen",                                          gamma_url: G("Lektion-19-Ein-Leben-lang-lernen-1fauywkeq1z1qiy") },
  { level: "A2", lesson_number: 20, title: "Arbeiten im Ausland",       subtitle: "Temporale Präpositionen", gamma_url: G("Lektion-20-Arbeiten-im-Ausland-Temporale-Prapositionen-x82frsip2h0f9si") },
  { level: "A2", lesson_number: 21, title: "Weiterbildung",             subtitle: "Passiv im Präteritum",    gamma_url: G("Lektion-21-Weiterbildung-Passiv-im-Prateritum-sp9491qw88iegyk") },
  { level: "A2", lesson_number: 22, title: "Pläne und Vermutungen",     subtitle: "Futur I & werden",        gamma_url: G("Lektion-22-Plane-und-Vermutungen-Futur-I-werden-b9q13hc8qyl3rib") },
  { level: "A2", lesson_number: 23, title: "Fit für den Alltag",        subtitle: "weil vs. deshalb",        gamma_url: G("Lektion-23-Fit-fur-den-Alltag-weil-vs-deshalb-4dxizp4vuowd7ri") },
  { level: "A2", lesson_number: null, title: "A2-Zusammenfassung",      subtitle: "Upgrade für flüssiges Deutsch", is_summary: true, gamma_url: G("A2-Zusammenfassung-Dein-Upgrade-fur-flussiges-Deutsch-r8e5igsah48jjv2") },

  // ══════════════════════════════════════════════════════════════════════════
  // B1 — 20 lessons in 4 módulos
  // ══════════════════════════════════════════════════════════════════════════
  { level: "B1", module_name: "Módulo 1",  lesson_number: 1,  title: "Lebenswege und Biografien",                                                   gamma_url: G("B1-Sektion-1-Lebenswege-und-Biografien-r0h0phxlapj05yi") },
  { level: "B1", module_name: "Módulo 1",  lesson_number: 2,  title: "Soziale Beziehungen", subtitle: "Adjektive mit Präpositionen",                gamma_url: G("Sektion-2-Soziale-Beziehungen-und-Adjektive-mit-Prapositionen-rnjohhpn9ntpj5z") },
  { level: "B1", module_name: "Módulo 1",  lesson_number: 3,  title: "Wohnen und Umgebung",  subtitle: "Wechselpräpositionen",                      gamma_url: G("Sektion-3-Wohnen-und-Umgebung-Wechselprapositionen-nz60n5sgwa1bf58") },
  { level: "B1", module_name: "Módulo 1",  lesson_number: 4,  title: "Haushalt und Pflichten",                                                      gamma_url: G("Sektion-4-Haushalt-und-Pflichten-uwh8hz22b3oe10j") },
  { level: "B1", module_name: "Módulo 1",  lesson_number: 5,  title: "Einladungen und Geschenke",                                                   gamma_url: G("Sektion-5-Einladungen-und-Geschenke-5adqq4fkdhll1aj") },
  { level: "B1", module_name: "Módulo 2",  lesson_number: 6,  title: "Gesundheit und Vorsorge",                                                     gamma_url: G("Lektion-6-Gesundheit-und-Vorsorge-x0gtq1une58uul4") },
  { level: "B1", module_name: "Módulo 2",  lesson_number: 7,  title: "Schule und Lernen",                                                           gamma_url: G("Sektion-6-Schule-und-Lernen-vnoeboa9zjpaejl") },
  { level: "B1", module_name: "Módulo 2",  lesson_number: 8,  title: "Digitale Arbeitswelt",                                                        gamma_url: G("Lektion-8-Digitale-Arbeitswelt-wh18jziizlxv3jx") },
  { level: "B1", module_name: "Módulo 2",  lesson_number: 9,  title: "Bewerbung und Vorstellungsgespräch",                                          gamma_url: G("Sektion-9-Bewerbung-und-Vorstellungsgesprach-ag5bgv5g1k18g1i") },
  { level: "B1", module_name: "Módulo 2",  lesson_number: 10, title: "Nachhaltiger Konsum",                                                         gamma_url: G("Lektion-10-Nachhaltiger-Konsum-lilcstuyosuvvws") },
  { level: "B1", module_name: "Módulo 3",  lesson_number: 11, title: "Die Kraft der Argumentation",                                                 gamma_url: G("Lektion-11-Die-Kraft-der-Argumentation-wwtyc0a4a2wng5h") },
  { level: "B1", module_name: "Módulo 3",  lesson_number: 12, title: "Zeitgeschichte und die Wende",                                                gamma_url: G("Lektion-12-Zeitgeschichte-und-die-Wende-pz6net0az1n7mrl") },
  { level: "B1", module_name: "Módulo 3",  lesson_number: 13, title: "Interkulturelle Kompetenz",                                                   gamma_url: G("Lektion-13-Interkulturelle-Kompetenz-Einfuhrung-uvhjvsh8wp4cpxa") },
  { level: "B1", module_name: "Módulo 3",  lesson_number: 14, title: "Weiterbildung und Studium",                                                   gamma_url: G("Lektion-14-Weiterbildung-und-Studium-ldoo8aqgcikowci") },
  { level: "B1", module_name: "Módulo 3",  lesson_number: 15, title: "Der Bewerbungsprozess",                                                       gamma_url: G("Lektion-15-Der-Bewerbungsprozess--njwr73i7nqs1s1z") },
  { level: "B1", module_name: "Módulo 4",  lesson_number: 16, title: "Das Vorstellungsgespräch",                                                    gamma_url: G("Lektion-16-Das-Vorstellungsgesprach-9p5zzdz2dtaa4bj") },
  { level: "B1", module_name: "Módulo 4",  lesson_number: 17, title: "Die Welt bereisen",                                                           gamma_url: G("Lektion-17-Die-Welt-Reisen-qknbxvwnwejgb7v") },
  { level: "B1", module_name: "Módulo 4",  lesson_number: 18, title: "Recht und Gerechtigkeit",                                                     gamma_url: G("Lektion-18-Recht-und-Gerechtigkeit-ojbwz2yiyjvia33") },
  { level: "B1", module_name: "Módulo 4",  lesson_number: 19, title: "Finanzen und Investment",                                                     gamma_url: G("Lektion-19-Finanzen-und-Investment-9187rqq8sfv8nnd") },
  { level: "B1", module_name: "Módulo 4",  lesson_number: 20, title: "Der Strategie-Mix",     subtitle: "B1-Finale",                                gamma_url: G("Lektion-20-Der-Strategie-Mix-Das-B1-Finale-62oy3hcrccaijzv") },

  // ══════════════════════════════════════════════════════════════════════════
  // B2 — 22 lessons in 7 módulos
  // ══════════════════════════════════════════════════════════════════════════
  { level: "B2", module_name: "Módulo 1: B1-Refresher",           lesson_number: 1,  title: "Das Passiv-Training",        subtitle: "Passiv Präsens & Präteritum", gamma_url: G("Lektion-01-Das-Passiv-Training-h43g5v5rjgui0cj") },
  { level: "B2", module_name: "Módulo 1: B1-Refresher",           lesson_number: 2,  title: "Hypothetische Welten",        subtitle: "Konjunktiv II",              gamma_url: G("Lektion-02-Hypothetische-Welten-r2qajj3j5qfp5cj") },
  { level: "B2", module_name: "Módulo 1: B1-Refresher",           lesson_number: 3,  title: "Präzision im Satz",           subtitle: "Relativsätze & Genitiv",     gamma_url: G("Lektion-03-Prazision-im-Satz-50rd6gklmptvhy0") },
  { level: "B2", module_name: "Módulo 1: B1-Refresher",           lesson_number: 4,  title: "Logik & Argumentation",       subtitle: "Konnektoren",                gamma_url: G("Lektion-04-Logik-Argumentation-3qs0dw3c2e2w0lb") },
  { level: "B2", module_name: "Módulo 1: B1-Refresher",           lesson_number: 5,  title: "Verben & Strukturen",         subtitle: "Infinitiv mit zu",           gamma_url: G("Lektion-05-Verben-Strukturen-ui7hdulwrn2l64f") },
  { level: "B2", module_name: "Módulo 2: Kommunikation & Identität", lesson_number: 6,  title: "Kommunikation im Alltag",     subtitle: "Nomen-Verb-Verbindungen",    gamma_url: G("Lektion-06-Kommunikation-im-Alltag-3eau5focb3pfl62") },
  { level: "B2", module_name: "Módulo 2: Kommunikation & Identität", lesson_number: 7,  title: "Konflikte lösen",             subtitle: "Zweiteilige Konnektoren",    gamma_url: G("Lektion-07-Konflikte-losen-rznnqge9nlm5fej") },
  { level: "B2", module_name: "Módulo 2: Kommunikation & Identität", lesson_number: 8,  title: "Heimat & Identität",          subtitle: "Partizip I y II",            gamma_url: G("Lektion-08-Heimat-Identitat-omp3m9hr2ghakgw") },
  { level: "B2", module_name: "Módulo 3: Berufsleben",            lesson_number: 9,  title: "Bewerbungstraining High-Level", subtitle: "Nominalisierung",            gamma_url: G("Lektion-09-Bewerbungstraining-High-Level-7zjwtzp2ygr1tav") },
  { level: "B2", module_name: "Módulo 3: Berufsleben",            lesson_number: 10, title: "Arbeitsformen der Zukunft",    subtitle: "Passiv-Ersatzformen",        gamma_url: G("Lektion-10-Arbeitsformen-der-Zukunft-wxdvijlv57dm1sf") },
  { level: "B2", module_name: "Módulo 3: Berufsleben",            lesson_number: 11, title: "Das professionelle Meeting",    subtitle: "Konjunktiv II diplomático",  gamma_url: G("Lektion-11-Das-professionelle-Meeting-g8iiflyvx321a6n") },
  { level: "B2", module_name: "Módulo 4: Innovation & Medien",    lesson_number: 12, title: "Forschung & Erfindungen",       subtitle: "Verben mit Präpositionen",   gamma_url: G("Lektion-12-Forschung-Erfindungen-etk0v69r0pf8g2m") },
  { level: "B2", module_name: "Módulo 4: Innovation & Medien",    lesson_number: 13, title: "Medien & Nachrichten",          subtitle: "Konjunktiv I (indirekte Rede)", gamma_url: G("Lektion-13-Medien-Nachrichten-wv20hkj2gd3zbj2") },
  { level: "B2", module_name: "Módulo 4: Innovation & Medien",    lesson_number: 14, title: "Umwelt & Nachhaltigkeit",       subtitle: "Adverbiale Nebensätze",      gamma_url: G("Lektion-14-Umwelt-Nachhaltigkeit-tprgiyagcwj1lak") },
  { level: "B2", module_name: "Módulo 5: Grammatikalische Präzision", lesson_number: 15, title: "Die Kraft der Nomen",       subtitle: "Nominalisierung",            gamma_url: G("Lektion-15-Die-Kraft-der-Nomen-bhyvalxj3dgt0p2") },
  { level: "B2", module_name: "Módulo 5: Grammatikalische Präzision", lesson_number: 16, title: "Komplexe Attribute",        subtitle: "Partizipialattribute",       gamma_url: G("Lektion-16-Komplexe-Attribute-zf6y8rrxfnhudox") },
  { level: "B2", module_name: "Módulo 5: Grammatikalische Präzision", lesson_number: 17, title: "Vermutungen äußern",         subtitle: "Subjektive Modalverben",     gamma_url: G("Lektion-17-Vermutungen-auern-oqzdsugtegldz93") },
  { level: "B2", module_name: "Módulo 6: Finanzen & Gesellschaft", lesson_number: 18, title: "Finanzen & Investment Pro",   subtitle: "Doppelkonnektoren",          gamma_url: G("Lektion-18-Finanzen-Investment-Pro-qwptt0xrh8xrc2h") },
  { level: "B2", module_name: "Módulo 6: Finanzen & Gesellschaft", lesson_number: 19, title: "Recht & Gesetz",              subtitle: "Indirekte Rede (Vergangenheit)", gamma_url: G("Lektion-19-Recht-Gesetz-3jum0tfhed4t1eb") },
  { level: "B2", module_name: "Módulo 6: Finanzen & Gesellschaft", lesson_number: 20, title: "Politik & Mitbestimmung",     subtitle: "Wortbildung",                gamma_url: G("Lektion-20-Politik-Mitbestimmung-kugyxfqqziq34m5") },
  { level: "B2", module_name: "Módulo 7: Finale",                 lesson_number: 21, title: "Redemittel & Nuancen",        subtitle: "Modalpartikeln",             gamma_url: G("Lektion-21-Redemittel-Nuancen-lrsvwdg1ftjaw3d") },
  { level: "B2", module_name: "Módulo 7: Finale",                 lesson_number: 22, title: "B2-Abschluss",                subtitle: "Strategie-Mix",              gamma_url: G("Lektion-22-B2-Abschluss-Strategie-Mix-6rlppaogb6tx99y") },
];

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let inserted = 0, updated = 0;
await c.query("BEGIN");
for (const m of MATERIALS) {
  const res = await c.query(
    `INSERT INTO shared_materials
         (level, module_name, lesson_number, title, subtitle, gamma_url, is_summary)
     VALUES ($1::cefr_level, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (level, gamma_url) DO UPDATE SET
         module_name   = EXCLUDED.module_name,
         lesson_number = EXCLUDED.lesson_number,
         title         = EXCLUDED.title,
         subtitle      = EXCLUDED.subtitle,
         is_summary    = EXCLUDED.is_summary,
         updated_at    = now()
     RETURNING (xmax = 0) AS was_insert`,
    [m.level, m.module_name ?? null, m.lesson_number ?? null,
     m.title, m.subtitle ?? null, m.gamma_url, m.is_summary ?? false],
  );
  if (res.rows[0].was_insert) inserted++; else updated++;
}
await c.query("COMMIT");

const { rows: counts } = await c.query(`
  SELECT level, COUNT(*)::int AS n FROM shared_materials GROUP BY level ORDER BY level`);
console.log(`✓ Seed complete — inserted ${inserted} nuevos, updated ${updated}`);
for (const r of counts) console.log(`  ${r.level}: ${r.n}`);
await c.end();
