import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { uploadObject } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;   // 5 min — basta para 28 archivos

/**
 * GET /api/admin/seed-materiales
 *
 * One-shot endpoint que carga las 14 lecciones generadas (A0-C2) en
 * la biblioteca de recursos para profesores. Lee los archivos desde
 * el repo de GitHub (raw.githubusercontent.com) — el repo es público
 * y los archivos están commiteados en /materiales/.
 *
 * Por cada lección: 1 PDF (presentación profesor) + 1 docx (cuaderno
 * alumno). Total: 28 recursos.
 *
 * Idempotente: si el título ya existe, salta.
 *
 * Auth: requireRole(['superadmin']).
 *
 * Uploader: el primer teacher con email aprenderaleman2026@gmail.com
 * (Gelfis). Si no existe se aborta.
 */

const LECCIONES = [
  { level: "A0", n: 1, slug: "alphabet-und-aussprache",      title: "Das Alphabet und die Aussprache" },
  { level: "A0", n: 2, slug: "begruessungen-vorstellen",     title: "Begrüßungen und sich vorstellen" },
  { level: "A1", n: 1, slug: "zahlen-uhrzeit-datum",         title: "Zahlen, Uhrzeit und Datum" },
  { level: "A1", n: 2, slug: "familie-possessivartikel",     title: "Die Familie und Possessivartikel" },
  { level: "A2", n: 1, slug: "restaurant-akkusativ",         title: "Im Restaurant — Essen bestellen (Akkusativ)" },
  { level: "A2", n: 2, slug: "wegbeschreibung-dativ",        title: "Wegbeschreibung (Dativ + Präpositionen)" },
  { level: "B1", n: 1, slug: "trennbare-verben-perfekt",     title: "Trennbare Verben und das Perfekt" },
  { level: "B1", n: 2, slug: "reisen-praeteritum-perfekt",   title: "Reisen erzählen — Präteritum vs. Perfekt" },
  { level: "B2", n: 1, slug: "konjunktiv-zwei",              title: "Konjunktiv II — Wünsche, Höflichkeit und Hypothesen" },
  { level: "B2", n: 2, slug: "passiv-unpersoenlich",         title: "Passiv und unpersönliche Konstruktionen" },
  { level: "C1", n: 1, slug: "nominalstil-nebensaetze",      title: "Nominalstil und komplexe Nebensätze" },
  { level: "C1", n: 2, slug: "idiomatische-redewendungen",   title: "Idiomatische Redewendungen" },
  { level: "C2", n: 1, slug: "stilebenen-kreatives-schreiben", title: "Stilebenen und kreatives Schreiben" },
  { level: "C2", n: 2, slug: "diskursanalyse-argumentation", title: "Diskursanalyse — Argumentation und Debatte" },
];

const RAW_BASE = "https://raw.githubusercontent.com/aprenderaleman/b2c/main/materiales";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  // 1. Resolver uploader
  const { data: uploader, error: uErr } = await sb
    .from("teachers")
    .select("id, user:users!inner(email, full_name)")
    .eq("user.email", "aprenderaleman2026@gmail.com")
    .maybeSingle();
  if (uErr || !uploader) {
    return NextResponse.json({ error: "uploader_not_found", message: "No se encontró el teacher Gelfis." }, { status: 500 });
  }
  const teacherId = (uploader as { id: string }).id;

  const results: Array<{ title: string; status: string; reason?: string }> = [];
  let uploaded = 0, skipped = 0, failed = 0;

  for (const L of LECCIONES) {
    const items: Array<{
      kind: "pdf" | "doc";
      filename: string;
      title: string;
      topic: string;
      description: string;
      studentVisible: boolean;
    }> = [
      {
        kind: "pdf",
        filename: `${L.level}-leccion-${L.n}-${L.slug}-presentacion.pdf`,
        title: `${L.level} · Lektion ${L.n} — ${L.title}`,
        topic: "presentación oficial",
        description: `Presentación oficial para clase en vivo. Tema: ${L.title}. Incluye objetivos, vocabulario, gramática, ejemplos y ejercicio guiado.`,
        studentVisible: false,                      // solo profes
      },
      {
        kind: "pdf",
        filename: `${L.level}-leccion-${L.n}-${L.slug}-cuaderno.pdf`,
        title: `${L.level} · Cuaderno Lektion ${L.n} — ${L.title} (PDF)`,
        topic: "cuaderno alumno",
        description: `Cuaderno del alumno (PDF para imprimir o leer en pantalla). ${L.title}. 5 ejercicios + vocabulario + espacio para notas.`,
        studentVisible: true,                       // PDF se abre en el navegador
      },
      {
        kind: "doc",
        filename: `${L.level}-leccion-${L.n}-${L.slug}-cuaderno.docx`,
        title: `${L.level} · Cuaderno Lektion ${L.n} — ${L.title} (Word)`,
        topic: "cuaderno alumno",
        description: `Cuaderno del alumno en Word (editable, para descargar y rellenar). ${L.title}.`,
        studentVisible: true,                       // .docx para editar
      },
    ];

    for (const item of items) {
      try {
        // Idempotencia
        const { data: existing } = await sb
          .from("teacher_resources")
          .select("id")
          .eq("title", item.title)
          .maybeSingle();
        if (existing) {
          results.push({ title: item.title, status: "skipped", reason: "already exists" });
          skipped++;
          continue;
        }

        // Descargar de raw github
        const url = `${RAW_BASE}/${L.level}/${item.filename}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          results.push({ title: item.title, status: "failed", reason: `github fetch ${resp.status}` });
          failed++;
          continue;
        }
        const arrayBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrayBuf);

        // Subir a R2
        const mime = item.kind === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const key = `teacher-resources/${teacherId}/seed-${Date.now()}-${item.filename}`;
        const up = await uploadObject(key, buf, mime);
        if (!up.ok) {
          results.push({ title: item.title, status: "failed", reason: `r2 ${up.error}` });
          failed++;
          continue;
        }

        // Insertar
        const { error: insErr } = await sb.from("teacher_resources").insert({
          uploaded_by:     teacherId,
          title:           item.title,
          description:     item.description,
          level:           L.level,
          topic:           item.topic,
          kind:            item.kind,
          file_url:        up.url,
          file_name:       item.filename,
          file_size_bytes: buf.length,
          storage_key:     up.key,
          tags:            ["oficial", item.topic === "presentación oficial" ? "presentación" : "cuaderno", L.level.toLowerCase(), L.slug],
          student_visible: item.studentVisible,
        });
        if (insErr) {
          results.push({ title: item.title, status: "failed", reason: `db ${insErr.message}` });
          failed++;
          continue;
        }
        results.push({ title: item.title, status: "uploaded" });
        uploaded++;
      } catch (e) {
        results.push({ title: item.title, status: "failed", reason: e instanceof Error ? e.message : "unknown" });
        failed++;
      }
    }
  }

  return NextResponse.json(
    { ok: true, uploaded, skipped, failed, total: results.length, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
