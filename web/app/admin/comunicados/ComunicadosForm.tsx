"use client";

import { useMemo, useState, useTransition } from "react";
import type { AudienceFilter, Channel, Recipient, SendResultRow } from "@/lib/comunicados/types";

type Group = { id: string; name: string; level: string };

type AudienceKind = "all_students" | "all_teachers" | "level" | "group" | "custom";
type StudentStatus = "active" | "paused" | "all";
type Level = "A1" | "A2" | "B1" | "B2" | "C1";
type LanguageChoice = "" | "es" | "de";

type SendResponse = {
  ok: boolean;
  broadcast_id: string | null;
  total_recipients: number;
  ok_count: number;
  fail_count: number;
  results: SendResultRow[];
};

const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1"];

/**
 * Main composer. Builds an AudienceFilter + message, previews it,
 * then opens a confirm modal before POST-ing to /send. The preview +
 * the send both re-resolve recipients server-side so the client can't
 * spoof the audience.
 */
export function ComunicadosForm({ groups }: { groups: Group[] }) {
  // --- Audience ---
  const [kind,   setKind]   = useState<AudienceKind>("all_students");
  const [status, setStatus] = useState<StudentStatus>("active");
  const [level,  setLevel]  = useState<Level>("B1");
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ?? "");
  const [language, setLanguage] = useState<LanguageChoice>("");
  const [customEmails, setCustomEmails] = useState("");
  const [customPhones, setCustomPhones] = useState("");

  // --- Message ---
  const [subject, setSubject]   = useState("");
  const [markdown, setMarkdown] = useState("");
  const [emailOn, setEmailOn]   = useState(true);
  const [whatsOn, setWhatsOn]   = useState(true);

  // --- Preview / send state ---
  const [pending, start]          = useTransition();
  const [preview, setPreview]     = useState<Recipient[] | null>(null);
  const [previewErr, setPrevErr]  = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sendResult, setSendResult] = useState<SendResponse | null>(null);
  const [sendErr, setSendErr]     = useState<string | null>(null);

  const channels: Channel[] = useMemo(() => {
    const out: Channel[] = [];
    if (emailOn) out.push("email");
    if (whatsOn) out.push("whatsapp");
    return out;
  }, [emailOn, whatsOn]);

  const audienceFilter = useMemo((): AudienceFilter => {
    const lang = language || undefined;
    switch (kind) {
      case "all_students": return { kind: "all_students", status, language: lang };
      case "all_teachers": return { kind: "all_teachers", language: lang };
      case "level":        return { kind: "level", level, status, language: lang };
      case "group":        return { kind: "group", group_id: groupId, language: lang };
      case "custom":       return {
        kind: "custom",
        custom_emails: splitList(customEmails),
        custom_phones: splitList(customPhones),
      };
    }
  }, [kind, status, level, groupId, language, customEmails, customPhones]);

  const canPreview = channels.length > 0 && (
    kind !== "custom" || splitList(customEmails).length + splitList(customPhones).length > 0
  );
  const canSend = preview !== null && preview.length > 0 && subject.trim() && markdown.trim() && channels.length > 0;

  const handlePreview = () => {
    setPrevErr(null);
    setSendResult(null);
    start(async () => {
      try {
        const res = await fetch("/api/admin/comunicados/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience_filter: audienceFilter }),
        });
        const data = await res.json();
        if (!res.ok) { setPrevErr(data?.message ?? data?.error ?? "Error en la previsualización."); return; }
        setPreview(data.recipients as Recipient[]);
      } catch (e) {
        setPrevErr(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  const handleSend = () => {
    setSendErr(null);
    setSendResult(null);
    setModalOpen(false);
    start(async () => {
      try {
        const res = await fetch("/api/admin/comunicados/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audience_filter:  audienceFilter,
            subject:          subject.trim(),
            message_markdown: markdown.trim(),
            channels,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setSendErr(data?.message ?? data?.error ?? "Error al enviar."); return; }
        setSendResult(data as SendResponse);
        // refresh history panel
        window.dispatchEvent(new CustomEvent("comunicados:sent"));
      } catch (e) {
        setSendErr(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  const renderedHtml = useMemo(() => {
    return wrapPreviewHtml(markdown, subject);
  }, [markdown, subject]);

  const renderedWhatsapp = useMemo(() => {
    return markdownToPlain(markdown);
  }, [markdown]);

  return (
    <div className="space-y-5">
      {/* ── Audience card ───────────────────────────────────────────── */}
      <section className="surface-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          1. ¿A quién?
        </h2>

        <div className="grid sm:grid-cols-5 gap-2">
          {(["all_students","all_teachers","level","group","custom"] as AudienceKind[]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold border transition-colors ${
                kind === k
                  ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-500/10 dark:text-brand-200"
                  : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400"
              }`}
            >
              {audienceLabel(k)}
            </button>
          ))}
        </div>

        {/* Sub-filters per kind */}
        <div className="grid sm:grid-cols-2 gap-3">
          {(kind === "all_students" || kind === "level") && (
            <label className="block">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Estado</span>
              <select
                className="input-text mt-1"
                value={status}
                onChange={e => setStatus(e.target.value as StudentStatus)}
              >
                <option value="active">Activos</option>
                <option value="paused">Pausados</option>
                <option value="all">Todos</option>
              </select>
            </label>
          )}
          {kind === "level" && (
            <label className="block">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Nivel</span>
              <select
                className="input-text mt-1"
                value={level}
                onChange={e => setLevel(e.target.value as Level)}
              >
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
          {kind === "group" && (
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Grupo</span>
              <select
                className="input-text mt-1"
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
              >
                {groups.length === 0
                  ? <option value="">— no hay grupos —</option>
                  : groups.map(g => <option key={g.id} value={g.id}>{g.name} {g.level ? `(${g.level})` : ""}</option>)}
              </select>
            </label>
          )}
          {kind !== "custom" && (
            <label className="block">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Idioma (opcional)</span>
              <select
                className="input-text mt-1"
                value={language}
                onChange={e => setLanguage(e.target.value as LanguageChoice)}
              >
                <option value="">Cualquiera</option>
                <option value="es">Español</option>
                <option value="de">Alemán</option>
              </select>
            </label>
          )}
          {kind === "custom" && (
            <>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Emails (separados por coma, punto y coma o salto de línea)
                </span>
                <textarea
                  rows={3}
                  className="input-text mt-1 font-mono text-[13px]"
                  value={customEmails}
                  onChange={e => setCustomEmails(e.target.value)}
                  placeholder="gelfis07@gmail.com, profe@ejemplo.com"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Teléfonos E.164 (separados por coma, punto y coma o salto de línea)
                </span>
                <textarea
                  rows={2}
                  className="input-text mt-1 font-mono text-[13px]"
                  value={customPhones}
                  onChange={e => setCustomPhones(e.target.value)}
                  placeholder="+4915253409644, +34695802550"
                />
              </label>
            </>
          )}
        </div>
      </section>

      {/* ── Message card ─────────────────────────────────────────────── */}
      <section className="surface-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          2. Mensaje
        </h2>

        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Asunto (email)</span>
          <input
            type="text"
            className="input-text mt-1"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Ej: Cambio de horario mañana"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Cuerpo (markdown: **negrita**, *cursiva*, - listas, [texto](url))
          </span>
          <textarea
            rows={10}
            className="input-text mt-1"
            value={markdown}
            onChange={e => setMarkdown(e.target.value)}
            placeholder={"Mañana la clase cambia de las 18h a las 19h por logística.\n\nAvísame si no puedes, por favor.\n\nGracias,\n— Gelfis"}
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={emailOn} onChange={e => setEmailOn(e.target.checked)} className="h-4 w-4 accent-orange-500" />
            Email
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={whatsOn} onChange={e => setWhatsOn(e.target.checked)} className="h-4 w-4 accent-orange-500" />
            WhatsApp
          </label>
        </div>

        {/* Live previews */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Previsualización email
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white">
              <iframe
                title="Email preview"
                srcDoc={renderedHtml}
                sandbox=""
                className="w-full h-[380px]"
              />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Previsualización WhatsApp
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 bg-[#e5ddd5] min-h-[380px] max-h-[380px] overflow-auto">
              <div className="max-w-[80%] bg-white rounded-xl rounded-tl-sm px-3 py-2 shadow-sm whitespace-pre-wrap text-[13px] text-slate-900 leading-snug">
                {renderedWhatsapp || <span className="text-slate-400">(vacío)</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Preview + send ──────────────────────────────────────────── */}
      <section className="surface-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            3. Revisar y enviar
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreview}
              disabled={pending || !canPreview}
              className="btn-secondary"
            >
              {pending && !modalOpen ? "Cargando…" : preview ? "Re-calcular destinatarios" : "Previsualizar destinatarios"}
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={pending || !canSend}
              className="btn-primary"
            >
              Enviar
            </button>
          </div>
        </div>

        {previewErr && <p className="text-sm text-red-600 dark:text-red-400">{previewErr}</p>}

        {preview && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4">
            <p className="text-sm text-slate-900 dark:text-slate-100 font-medium mb-3">
              {preview.length} destinatario{preview.length === 1 ? "" : "s"}
            </p>
            {preview.length === 0 ? (
              <p className="text-sm text-slate-500">Ningún destinatario coincide con el filtro.</p>
            ) : (
              <ol className="space-y-1.5 text-xs">
                {preview.map((r, idx) => (
                  <li key={`${r.user_id ?? "x"}-${r.email ?? r.phone ?? idx}`} className="flex items-center justify-between gap-3">
                    <span className="text-slate-700 dark:text-slate-200 min-w-0 truncate">
                      <span className="text-slate-400">{String(idx + 1).padStart(2, "0")}.</span>{" "}
                      <span className="font-medium">{r.name || r.email || r.phone}</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {r.email ?? "—"} · {r.phone ?? "—"} · {r.channels_available.join("+") || "(sin canal)"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {sendErr && <p className="text-sm text-red-600 dark:text-red-400">{sendErr}</p>}

        {sendResult && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {sendResult.ok_count} ok
              {sendResult.fail_count > 0 && <span className="text-red-600 dark:text-red-400"> · {sendResult.fail_count} con error</span>}
              {" "}· {sendResult.total_recipients} total
            </p>
            <ul className="mt-3 space-y-1.5 text-xs">
              {sendResult.results.map((r, i) => (
                <li key={`${r.user_id ?? "x"}-${i}`} className="grid grid-cols-[1fr_auto_auto] gap-3 items-baseline">
                  <span className="text-slate-700 dark:text-slate-200 truncate">
                    {r.name || r.email || r.phone}
                  </span>
                  <span className={`font-mono text-[11px] ${r.email_r ? (r.email_r.ok ? "text-emerald-600" : "text-red-600") : "text-slate-400"}`}>
                    email: {r.email_r ? (r.email_r.ok ? "✓" : `✗ ${r.email_r.error ?? ""}`) : "—"}
                  </span>
                  <span className={`font-mono text-[11px] ${r.whatsapp_r ? (r.whatsapp_r.ok ? "text-emerald-600" : "text-red-600") : "text-slate-400"}`}>
                    wa: {r.whatsapp_r ? (r.whatsapp_r.ok ? "✓" : `✗ ${r.whatsapp_r.error ?? ""}`) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Confirm modal ───────────────────────────────────────────── */}
      {modalOpen && preview && (
        <ConfirmModal
          subject={subject.trim()}
          channels={channels}
          recipientCount={preview.length}
          audience={kind}
          onCancel={() => setModalOpen(false)}
          onConfirm={handleSend}
          pending={pending}
        />
      )}
    </div>
  );
}

function ConfirmModal(props: {
  subject: string;
  channels: Channel[];
  recipientCount: number;
  audience: AudienceKind;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const { subject, channels, recipientCount, audience, onCancel, onConfirm, pending } = props;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">Confirmar envío</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Vas a enviar este mensaje. Esta acción no se puede deshacer.
        </p>
        <div className="mt-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 text-sm space-y-1.5">
          <div><span className="text-slate-500">Audiencia:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{audienceLabel(audience)}</span></div>
          <div><span className="text-slate-500">Destinatarios:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{recipientCount}</span></div>
          <div><span className="text-slate-500">Canales:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{channels.join(" + ")}</span></div>
          <div><span className="text-slate-500">Asunto:</span> <span className="font-medium text-slate-900 dark:text-slate-100 break-words">{subject}</span></div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={pending} className="btn-secondary">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="btn-primary">
            {pending ? "Enviando…" : `Enviar a ${recipientCount}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function audienceLabel(k: AudienceKind): string {
  switch (k) {
    case "all_students": return "Estudiantes";
    case "all_teachers": return "Profesores";
    case "level":        return "Por nivel";
    case "group":        return "Grupo";
    case "custom":       return "Custom";
  }
}

function splitList(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Preview helpers — client-side only. These produce a *visual approximation*
// so the admin sees their formatting live. The real render happens server-side
// in lib/comunicados/render.ts when the message is sent.
// ---------------------------------------------------------------------------
function wrapPreviewHtml(markdown: string, subject: string): string {
  const body = md(markdown);
  const safeSubject = escape(subject || "(sin asunto)");
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#fff7ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.55;">
<div style="max-width:560px;margin:20px auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #fed7aa;">
  <div style="padding:20px 24px;background:linear-gradient(135deg,#fb923c 0%,#f97316 100%);color:white;">
    <div style="font-size:18px;font-weight:800;">Aprender-Aleman.de</div>
    <div style="font-size:12px;color:#ffedd5;margin-top:2px;">Academia Premium Online</div>
  </div>
  <div style="padding:20px 24px;">
    <div style="font-size:12px;color:#94a3b8;margin-bottom:10px;">Asunto: <strong style="color:#0f172a;">${safeSubject}</strong></div>
    ${body}
  </div>
</div></body></html>`;
}

function md(src: string): string {
  const blocks = (src || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const b of blocks) {
    if (/^-{3,}$/.test(b)) { parts.push('<hr style="border:0;border-top:1px solid #fed7aa;margin:14px 0;">'); continue; }
    if (b.split("\n").every(l => /^\s*-\s+/.test(l))) {
      const items = b.split("\n").map(l => l.replace(/^\s*-\s+/, "")).map(l => `<li style="margin:4px 0;font-size:15px;color:#334155;">${inline(l)}</li>`).join("");
      parts.push(`<ul style="margin:0 0 12px 18px;padding:0;">${items}</ul>`);
      continue;
    }
    const lines = b.split("\n").map(inline).join("<br>");
    parts.push(`<p style="margin:0 0 12px 0;font-size:15px;color:#334155;line-height:1.55;">${lines}</p>`);
  }
  return parts.join("") || '<p style="color:#94a3b8;font-style:italic;">(vacío)</p>';
}

function inline(s: string): string {
  let o = escape(s);
  o = o.replace(/`([^`]+)`/g, '<code style="background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:0 4px;font-size:13px;">$1</code>');
  o = o.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" style="color:#ea580c;text-decoration:none;">$1</a>');
  o = o.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  o = o.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return o;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownToPlain(src: string): string {
  return (src || "")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*-{3,}\s*$/gm, "————————————")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2");
}
