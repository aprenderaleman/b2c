import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorizeAulaAccess } from "@/lib/aula";
import { supabaseAdmin } from "@/lib/supabase";
import { createStudentNotesDoc, getTeacherEmail } from "@/lib/google-docs";

/**
 * GET /api/aula/{id}/apuntes
 *
 * Devuelve los documentos de apuntes de la clase para el botón
 * "Documentos de Apuntes" del aula (Gelfis 2026-10-14):
 *  - Clase regular: el Google Doc de apuntes de CADA estudiante
 *    (students.document_url). Si un estudiante aún no tiene, se crea
 *    al vuelo con la misma máquina del admin (createStudentNotesDoc)
 *    y se guarda.
 *  - Clase de prueba: un doc desechable "Apuntes Clase de Prueba -
 *    <lead>", creado la primera vez y cacheado en
 *    classes.apuntes_doc_url (migración 141) para no sembrar Drive
 *    de duplicados si el profe pulsa dos veces.
 *
 * Solo el host (profe de la clase) o un admin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Doc = { name: string; url: string };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: classId } = await params;
  const role = (session.user as { role: "superadmin"|"admin"|"teacher"|"student"|"closer" }).role;
  const decision = await authorizeAulaAccess(classId, (session.user as { id: string }).id, role);
  const isAdmin = role === "admin" || role === "superadmin";
  const isHost  = decision.ok && decision.role === "host";
  if (!decision.ok || (!isHost && !isAdmin)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("is_trial, lead_id, teacher_id, apuntes_doc_url")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const c = cls as {
    is_trial: boolean | null; lead_id: string | null;
    teacher_id: string | null; apuntes_doc_url: string | null;
  };

  // Nombre + email del profe (para compartir docs recién creados).
  let teacherName = "Profesor";
  let teacherEmail: string | null = null;
  if (c.teacher_id) {
    teacherEmail = await getTeacherEmail(c.teacher_id);
    const { data: t } = await sb
      .from("teachers").select("users!inner(full_name)").eq("id", c.teacher_id).maybeSingle();
    const tUsers = (t as unknown as { users: { full_name: string | null } | Array<{ full_name: string | null }> } | null)?.users ?? null;
    const tu = Array.isArray(tUsers) ? tUsers[0] : tUsers;
    teacherName = tu?.full_name ?? "Profesor";
  }

  // ── Clase de prueba: doc desechable, cacheado en la clase ──
  if (c.is_trial) {
    if (c.apuntes_doc_url) {
      return NextResponse.json({ docs: [{ name: "Apuntes (clase de prueba)", url: c.apuntes_doc_url }] });
    }
    let leadName = "Lead";
    if (c.lead_id) {
      const { data: lead } = await sb.from("leads").select("name").eq("id", c.lead_id).maybeSingle();
      leadName = (lead as { name: string | null } | null)?.name ?? "Lead";
    }
    const doc = await createStudentNotesDoc(
      `Clase de Prueba - ${leadName}`, "A1", teacherName, teacherEmail,
    );
    if (!doc) return NextResponse.json({ error: "doc_creation_failed" }, { status: 500 });
    await sb.from("classes").update({ apuntes_doc_url: doc.url }).eq("id", classId);
    return NextResponse.json({ docs: [{ name: `Apuntes — ${leadName} (prueba)`, url: doc.url }] });
  }

  // ── Clase regular: doc de cada estudiante inscrito ──
  const { data: parts } = await sb
    .from("class_participants")
    .select("students(id, document_url, current_level, users!inner(full_name))")
    .eq("class_id", classId);

  type PartRow = {
    students: {
      id: string; document_url: string | null; current_level: string | null;
      users: { full_name: string | null } | Array<{ full_name: string | null }>;
    } | Array<{
      id: string; document_url: string | null; current_level: string | null;
      users: { full_name: string | null } | Array<{ full_name: string | null }>;
    }> | null;
  };

  const docs: Doc[] = [];
  const seen = new Set<string>();
  for (const row of ((parts ?? []) as unknown as PartRow[])) {
    if (!row.students) continue;
    const s = Array.isArray(row.students) ? row.students[0] : row.students;
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    const name = u?.full_name ?? "Estudiante";

    let url = s.document_url;
    if (!url) {
      const doc = await createStudentNotesDoc(name, s.current_level ?? "A1", teacherName, teacherEmail);
      if (doc) {
        url = doc.url;
        await sb.from("students").update({ document_url: url }).eq("id", s.id);
      }
    }
    if (url) docs.push({ name, url });
  }

  if (docs.length === 0) {
    return NextResponse.json({ error: "no_docs", message: "La clase no tiene estudiantes con documento (y no se pudo crear ninguno)." }, { status: 404 });
  }
  return NextResponse.json({ docs });
}
