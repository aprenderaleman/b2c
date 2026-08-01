"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  ATTACHMENT_LIMITS,
  LEAD_LEVELS,
  LEAD_STATUS_GROUPS,
  LEAD_STATUS_GROUPS_DEFAULT,
  type Attachment,
  type AudienceFilter,
  type Channel,
  type LeadLevel,
  type LeadStatusGroup,
  type Recipient,
  type SendResultRow,
} from "@/lib/comunicados/types";

type Group = { id: string; name: string; level: string };

type AudienceKind = "all_students" | "all_teachers" | "level" | "group" | "leads" | "custom";
type StudentStatus = "active" | "paused" | "all";
type Level = "A1" | "A2" | "B1" | "B2" | "C1";
type LanguageChoice = "" | "es" | "de";

type SendResponse = {
  ok:               boolean;
  queued?:          boolean;
  drip?:            boolean;
  pacing_ms?:       number;
  broadcast_id:     string | null;
  total_recipients?: number;
  ok_count?:        number;
  fail_count?:      number;
  results?:         SendResultRow[];
  scheduled_at?:    string;
  dispatched?:      number;
  remaining?:       number;
};

/**
 * Shape passed in from page.tsx when the URL has `?edit=<id>` and the
 * row is still queued. Mirrors the columns we hydrate state from.
 */
export type EditingBroadcast = {
  id:               string;
  audience_filter:  AudienceFilter & { _marker?: string };
  subject:          string;
  message_markdown: string;
  channels:         Channel[];
  attachments:      Attachment[];
  scheduled_at:     string;        // ISO
  status:           "queued";
};

const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1"];

/** 5 min slack — must match SCHEDULE_MIN_LEAD_MS on the server. */
const SCHEDULE_MIN_LEAD_MS = 5 * 60 * 1000;

/** Must match DRIP_PACING_THRESHOLD_MS in send.ts */
const DRIP_PACING_THRESHOLD_MS = 5_000;

const PACING_OPTIONS: { label: string; value: number }[] = [
  { label: "Sin pausa (250 ms)",     value: 250    },
  { label: "30 segundos",            value: 30_000  },
  { label: "1 minuto",               value: 60_000  },
  { label: "2 minutos (recomendado para WA)", value: 120_000 },
  { label: "5 minutos",              value: 300_000 },
];

/**
 * Main composer. Builds an AudienceFilter + message, previews it,
 * then opens a confirm modal before POST-ing to /send. The preview +
 * the send both re-resolve recipients server-side so the client can't
 * spoof the audience.
 *
 * When `editing` is non-null we're editing a still-queued broadcast:
 * state is hydrated from the row, schedule mode is forced on, and the
 * submit posts to /update instead of /send.
 */
export function ComunicadosForm({
  groups,
  editing,
}: {
  groups:   Group[];
  editing?: EditingBroadcast | null;
}) {
  const isEditing = !!editing;
  const initial   = hydrateFromEditing(editing, groups);

  // --- Audience ---
  const [kind,   setKind]   = useState<AudienceKind>(initial.kind);
  const [status, setStatus] = useState<StudentStatus>(initial.status);
  const [level,  setLevel]  = useState<Level>(initial.level);
  const [groupId, setGroupId] = useState<string>(initial.groupId);
  const [language, setLanguage] = useState<LanguageChoice>(initial.language);
  const [leadStatusGroups, setLeadStatusGroups] = useState<LeadStatusGroup[]>(initial.leadStatusGroups);
  const [leadLevels, setLeadLevels] = useState<LeadLevel[]>(initial.leadLevels);
  const [customEmails, setCustomEmails] = useState(initial.customEmails);
  const [customPhones, setCustomPhones] = useState(initial.customPhones);

  // --- Message ---
  const [subject, setSubject]   = useState(initial.subject);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [emailOn, setEmailOn]   = useState(initial.emailOn);
  const [whatsOn, setWhatsOn]   = useState(initial.whatsOn);

  // --- Schedule & pacing ---
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">(initial.scheduleMode);
  const [scheduledLocal, setScheduledLocal] = useState<string>(initial.scheduledLocal);
  const [scheduleErr, setScheduleErr]       = useState<string | null>(null);
  const [pacingMs, setPacingMs]             = useState<number>(250);

  // --- Attachments (email-only) ---
  const [attachments, setAttachments] = useState<Attachment[]>(initial.attachments);
  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      case "leads":        return { kind: "leads", status_groups: leadStatusGroups, levels: leadLevels.length > 0 ? leadLevels : undefined, language: lang };
      case "custom":       return {
        kind: "custom",
        custom_emails: splitList(customEmails),
        custom_phones: splitList(customPhones),
      };
    }
  }, [kind, status, level, groupId, language, leadStatusGroups, leadLevels, customEmails, customPhones]);

  const canPreview = channels.length > 0 && (
    kind === "custom"
      ? splitList(customEmails).length + splitList(customPhones).length > 0
      : kind === "leads"
        ? leadStatusGroups.length > 0
        : true
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
        const text = await res.text();
        let data: Record<string, unknown> | null = null;
        try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* HTML or empty */ }

        if (res.status === 401) {
          setPrevErr("Sesión expirada — recarga la página e inicia sesión de nuevo.");
          return;
        }
        if (!data) {
          setPrevErr(`Error del servidor (HTTP ${res.status}). Recarga la página e intenta de nuevo.`);
          return;
        }
        if (!res.ok) {
          setPrevErr((data.message ?? data.error ?? "Error en la previsualización.") as string);
          return;
        }
        setPreview(data.recipients as Recipient[]);
      } catch (e) {
        setPrevErr(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  // ---------- Attachments ----------
  const totalAttachmentBytes = useMemo(
    () => attachments.reduce((s, a) => s + a.size, 0),
    [attachments],
  );

  const handleFilesSelected = async (filesList: FileList | null) => {
    if (!filesList || filesList.length === 0) return;
    setUploadErr(null);

    const remainingSlots = ATTACHMENT_LIMITS.MAX_FILES - attachments.length;
    if (remainingSlots <= 0) {
      setUploadErr(`Máximo ${ATTACHMENT_LIMITS.MAX_FILES} archivos.`);
      return;
    }
    const files = Array.from(filesList).slice(0, remainingSlots);

    setUploading(true);
    try {
      let runningTotal = totalAttachmentBytes;
      for (const f of files) {
        // Pre-flight client-side checks (server re-validates).
        const lower = f.name.toLowerCase();
        const extOk = ATTACHMENT_LIMITS.ALLOWED_EXT.some(ext => lower.endsWith(ext));
        if (!extOk) { setUploadErr(`"${f.name}" no es un tipo permitido (${ATTACHMENT_LIMITS.ALLOWED_EXT.join(", ")}).`); break; }
        if (f.size > ATTACHMENT_LIMITS.MAX_FILE_BYTES) { setUploadErr(`"${f.name}" supera ${prettyBytes(ATTACHMENT_LIMITS.MAX_FILE_BYTES)}.`); break; }
        if (runningTotal + f.size > ATTACHMENT_LIMITS.MAX_TOTAL_BYTES) {
          setUploadErr(`El total supera ${prettyBytes(ATTACHMENT_LIMITS.MAX_TOTAL_BYTES)}. Quita archivos o usa uno más pequeño.`);
          break;
        }

        const fd = new FormData();
        fd.append("file", f, f.name);
        const res = await fetch("/api/admin/comunicados/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUploadErr(data?.message ?? data?.error ?? `Subida fallida (${res.status}).`);
          break;
        }
        const att = data.attachment as Attachment;
        runningTotal += att.size;
        setAttachments(prev => [...prev, att]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // Compute scheduled_at as ISO UTC if the user chose "programar".
  const scheduledIso = useMemo<string | null>(() => {
    if (scheduleMode !== "schedule") return null;
    if (!scheduledLocal) return null;
    const t = new Date(scheduledLocal).getTime();
    if (isNaN(t)) return null;
    return new Date(t).toISOString();
  }, [scheduleMode, scheduledLocal]);

  // The button is allowed iff schedule input (if any) is well-formed.
  const scheduleValid = useMemo<boolean>(() => {
    setScheduleErr(null);
    if (scheduleMode === "now") return true;
    if (!scheduledIso) { setScheduleErr("Elige una fecha y hora."); return false; }
    const lead = new Date(scheduledIso).getTime() - Date.now();
    if (lead < SCHEDULE_MIN_LEAD_MS) {
      setScheduleErr("La hora elegida es demasiado pronto. Mínimo 5 min en el futuro.");
      return false;
    }
    return true;
  }, [scheduleMode, scheduledIso]);

  const handleSend = () => {
    setSendErr(null);
    setSendResult(null);
    setModalOpen(false);
    start(async () => {
      try {
        const url    = isEditing ? "/api/admin/comunicados/update" : "/api/admin/comunicados/send";
        const body: Record<string, unknown> = {
          audience_filter:  audienceFilter,
          subject:          subject.trim(),
          message_markdown: markdown.trim(),
          channels,
          attachments,
          pacing_ms:        pacingMs,
        };
        if (scheduledIso)  body.scheduled_at = scheduledIso;
        if (isEditing)     body.id = editing!.id;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let data: Record<string, unknown> | null = null;
        try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* HTML or empty */ }

        if (res.status === 401) { setSendErr("Sesión expirada — recarga la página e inicia sesión de nuevo."); return; }
        if (!data) { setSendErr(`Error del servidor (HTTP ${res.status}). Recarga la página e intenta de nuevo.`); return; }
        if (!res.ok) { setSendErr((data.message ?? data.error ?? "Error al enviar.") as string); return; }
        setSendResult(data as SendResponse);
        // refresh history panel
        window.dispatchEvent(new CustomEvent("comunicados:sent"));
        // If we just saved an edit, drop the ?edit=… so a second submit
        // wouldn't re-update unintentionally. Replace history so back
        // button doesn't bounce them into edit mode again.
        if (isEditing && typeof window !== "undefined") {
          window.history.replaceState(null, "", "/admin/comunicados");
        }
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
      {/* Edit banner — shown only when hydrating an existing queued row */}
      {isEditing && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/50 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <strong>Editando un comunicado programado.</strong>{" "}
            Los cambios sustituyen el envío original; el horario se mantiene salvo que lo modifiques abajo.
          </div>
          <a
            href="/admin/comunicados"
            className="text-xs underline font-semibold hover:text-amber-700"
          >
            Salir de edición
          </a>
        </div>
      )}

      {/* ── Audience card ───────────────────────────────────────────── */}
      <section className="surface-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          1. ¿A quién?
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {(["all_students","all_teachers","level","group","leads","custom"] as AudienceKind[]).map(k => (
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
          {kind === "leads" && (
            <div className="block sm:col-span-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Estado del lead</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setLeadStatusGroups(LEAD_STATUS_GROUPS_DEFAULT)}
                    className="text-brand-600 hover:underline"
                  >
                    Por defecto
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeadStatusGroups(Object.keys(LEAD_STATUS_GROUPS) as LeadStatusGroup[])}
                    className="text-brand-600 hover:underline"
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeadStatusGroups([])}
                    className="text-slate-500 hover:underline"
                  >
                    Ninguno
                  </button>
                </div>
              </div>
              <div className="mt-2 grid sm:grid-cols-2 gap-2">
                {(Object.entries(LEAD_STATUS_GROUPS) as [LeadStatusGroup, typeof LEAD_STATUS_GROUPS[LeadStatusGroup]][]).map(([key, def]) => {
                  const checked = leadStatusGroups.includes(key);
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                        checked
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                          : "border-slate-200 dark:border-slate-700 hover:border-brand-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setLeadStatusGroups(prev =>
                            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
                          );
                        }}
                        className="h-4 w-4 accent-orange-500"
                      />
                      <span className="text-sm">
                        {def.emoji} <span className="text-slate-800 dark:text-slate-100 font-medium">{def.label}</span>{" "}
                        <span className="text-[10px] text-slate-500">({def.raw.length})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {/* Level filter for leads */}
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Nivel de alemán (opcional)</span>
                  <div className="flex items-center gap-3 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setLeadLevels(LEAD_LEVELS.map(l => l.value))}
                      className="text-brand-600 hover:underline"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeadLevels([])}
                      className="text-slate-500 hover:underline"
                    >
                      Sin filtro
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {LEAD_LEVELS.map(({ value, label, emoji }) => {
                    const checked = leadLevels.length === 0 || leadLevels.includes(value);
                    const selected = leadLevels.includes(value);
                    return (
                      <label
                        key={value}
                        className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 cursor-pointer transition-colors text-sm ${
                          selected
                            ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                            : "border-slate-200 dark:border-slate-700 hover:border-brand-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            setLeadLevels(prev =>
                              prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
                            );
                          }}
                          className="h-3.5 w-3.5 accent-orange-500"
                        />
                        <span>{emoji} <span className="font-medium text-slate-800 dark:text-slate-100">{label}</span></span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {leadLevels.length === 0 ? "Sin filtro de nivel — se incluyen todos los niveles." : `Filtrando por ${leadLevels.length} nivel${leadLevels.length === 1 ? "" : "es"}.`}
                </p>
              </div>

              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Excluye automáticamente leads ya convertidos a alumno y los que no aceptaron GDPR.
              </p>
            </div>
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
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Cuerpo (markdown: **negrita**, *cursiva*, - listas, [texto](url))
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono select-all">
              {"{{nombre}}"} → primer nombre del destinatario
            </span>
          </div>
          <textarea
            rows={10}
            className="input-text mt-1"
            value={markdown}
            onChange={e => setMarkdown(e.target.value)}
            placeholder={"Hola {{nombre}},\n\nMañana la clase cambia de las 18h a las 19h.\n\nGracias,\n— Gelfis"}
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

        {/* Attachments — email-only */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                Adjuntos (solo email)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {ATTACHMENT_LIMITS.ALLOWED_EXT.join(", ")} · máx {ATTACHMENT_LIMITS.MAX_FILES} archivos · {prettyBytes(ATTACHMENT_LIMITS.MAX_TOTAL_BYTES)} total
              </div>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              {attachments.length}/{ATTACHMENT_LIMITS.MAX_FILES} · {prettyBytes(totalAttachmentBytes)}/{prettyBytes(ATTACHMENT_LIMITS.MAX_TOTAL_BYTES)}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_LIMITS.ALLOWED_EXT.join(",")}
              onChange={e => void handleFilesSelected(e.target.files)}
              disabled={uploading || attachments.length >= ATTACHMENT_LIMITS.MAX_FILES}
              className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:hover:bg-brand-600 file:text-white file:font-semibold file:px-3 file:py-2 file:cursor-pointer file:disabled:opacity-50"
            />
            {uploading && <span className="text-xs text-slate-500">Subiendo…</span>}
          </div>

          {uploadErr && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{uploadErr}</p>}

          {attachments.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {attachments.map((a, i) => (
                <li key={a.path} className="flex items-center justify-between gap-3 text-xs bg-white dark:bg-slate-900 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700">
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">📎 {a.name}</span>
                  <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0">{prettyBytes(a.size)}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(i)}
                    className="text-slate-400 hover:text-red-600 transition-colors text-base leading-none"
                    aria-label={`Quitar ${a.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!emailOn && attachments.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              ⚠️ Tienes adjuntos pero el canal email está desactivado — no se enviarán.
            </p>
          )}
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

      {/* ── Schedule ───────────────────────────────────────────────── */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          3. Cuándo enviar
        </h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScheduleMode("now")}
            disabled={isEditing}
            className={`rounded-xl px-4 py-3 text-sm font-semibold border transition-colors ${
              scheduleMode === "now"
                ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-500/10 dark:text-brand-200"
                : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            ⚡ Ahora
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("schedule")}
            className={`rounded-xl px-4 py-3 text-sm font-semibold border transition-colors ${
              scheduleMode === "schedule"
                ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-500/10 dark:text-brand-200"
                : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400"
            }`}
          >
            📅 Programar
          </button>
        </div>

        {isEditing && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Editar implica programación. Si quieres enviar ahora, cancela este programado y crea uno nuevo.
          </p>
        )}

        {/* Pacing dropdown */}
        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Pausa entre mensajes</span>
          <select
            className="input-text mt-1"
            value={pacingMs}
            onChange={e => setPacingMs(Number(e.target.value))}
          >
            {PACING_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {pacingMs > DRIP_PACING_THRESHOLD_MS && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-4 py-3 text-[12px] text-amber-900 dark:text-amber-200 space-y-1">
            <div><strong>Modo drip activado.</strong> Los mensajes se enviarán por lotes a lo largo del tiempo vía cron (cada 5 min).</div>
            {preview && preview.length > 0 && (
              <div>
                Con {preview.length} destinatarios y {pacingMs / 1000 >= 60 ? `${pacingMs / 60_000} min` : `${pacingMs / 1000} s`} de pausa,
                el envío completo tardará aproximadamente <strong>{formatDuration(preview.length * pacingMs)}</strong>.
              </div>
            )}
          </div>
        )}

        {scheduleMode === "schedule" && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Fecha y hora (zona del navegador)</span>
              <input
                type="datetime-local"
                className="input-text mt-1"
                value={scheduledLocal}
                onChange={e => setScheduledLocal(e.target.value)}
                min={localMinForInput()}
              />
            </label>
            {scheduledIso && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Saldrá <strong>{formatScheduled(scheduledIso)}</strong>.{" "}
                <span className="text-slate-500">El sistema revisa la cola cada 5 min, así que el envío real puede ser hasta 5 min después.</span>
              </p>
            )}
            {scheduleErr && <p className="text-xs text-red-600 dark:text-red-400">{scheduleErr}</p>}
          </div>
        )}
      </section>

      {/* ── Preview + send ──────────────────────────────────────────── */}
      <section className="surface-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            4. Revisar y enviar
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
              disabled={pending || !canSend || !scheduleValid}
              className="btn-primary"
            >
              {sendButtonLabel(isEditing, scheduleMode, scheduledIso)}
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

        {sendResult && sendResult.queued && (
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/40 p-4 text-sm text-emerald-900 dark:text-emerald-200">
            {sendResult.drip ? (
              <>
                <strong>✓ Enviando en modo drip.</strong> El primer lote ya está en cola.
                El cron irá despachando un lote cada 5 min hasta completar todos los destinatarios.
                Puedes ver el progreso en el historial abajo.
              </>
            ) : (
              <>
                <strong>✓ {isEditing ? "Cambios guardados" : "Programado"}.</strong>{" "}
                {sendResult.scheduled_at && <>Saldrá <strong>{formatScheduled(sendResult.scheduled_at)}</strong>.</>} Aparece en el historial abajo y puedes cancelarlo o editarlo hasta 5 min antes.
              </>
            )}
          </div>
        )}

        {sendResult && !sendResult.queued && sendResult.results && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {sendResult.ok_count ?? 0} ok
              {(sendResult.fail_count ?? 0) > 0 && <span className="text-red-600 dark:text-red-400"> · {sendResult.fail_count} con error</span>}
              {" "}· {sendResult.total_recipients ?? 0} total
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
          attachments={attachments}
          scheduledIso={scheduledIso}
          isEditing={isEditing}
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
  attachments: Attachment[];
  scheduledIso: string | null;
  isEditing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const { subject, channels, recipientCount, audience, attachments, scheduledIso, isEditing, onCancel, onConfirm, pending } = props;
  const totalAttachmentBytes = attachments.reduce((s, a) => s + a.size, 0);
  const title = isEditing
    ? "Confirmar cambios"
    : (scheduledIso ? "Confirmar programación" : "Confirmar envío");
  const blurb = isEditing
    ? "Vas a sustituir el comunicado programado con estos cambios."
    : (scheduledIso
        ? "El comunicado se guardará en cola y saldrá a la hora programada."
        : "Vas a enviar este mensaje. Esta acción no se puede deshacer.");
  const cta = pending
    ? (isEditing ? "Guardando…" : (scheduledIso ? "Programando…" : "Enviando…"))
    : (isEditing
        ? "Guardar cambios"
        : (scheduledIso ? `Programar (${recipientCount} hoy)` : `Enviar a ${recipientCount}`));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{blurb}</p>
        <div className="mt-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 text-sm space-y-1.5">
          <div><span className="text-slate-500">Audiencia:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{audienceLabel(audience)}</span></div>
          <div><span className="text-slate-500">Destinatarios:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{recipientCount}</span></div>
          <div><span className="text-slate-500">Canales:</span> <span className="font-medium text-slate-900 dark:text-slate-100">{channels.join(" + ")}</span></div>
          <div><span className="text-slate-500">Asunto:</span> <span className="font-medium text-slate-900 dark:text-slate-100 break-words">{subject}</span></div>
          {attachments.length > 0 && (
            <div>
              <span className="text-slate-500">Adjuntos:</span>{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {attachments.length} archivo{attachments.length === 1 ? "" : "s"} · {prettyBytes(totalAttachmentBytes)}
              </span>
              {!channels.includes("email") && (
                <span className="ml-1 text-amber-700 dark:text-amber-400">(no se enviarán — falta canal email)</span>
              )}
            </div>
          )}
          {scheduledIso && (
            <div>
              <span className="text-slate-500">Programado:</span>{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">{formatScheduled(scheduledIso)}</span>
              <div className="text-[11px] text-slate-500 mt-0.5">La audiencia se re-resuelve a la hora del envío.</div>
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={pending} className="btn-secondary">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="btn-primary">{cta}</button>
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
    case "leads":        return "Leads";
    case "custom":       return "Custom";
  }
}

function splitList(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function prettyBytes(n: number): string {
  if (n < 1024)            return `${n} B`;
  if (n < 1024 * 1024)     return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Min value for `<input type="datetime-local">`. Browsers want the
 * literal string "YYYY-MM-DDTHH:mm" in LOCAL time (no timezone).
 * We use now+5min so the picker visually disallows past times.
 */
function localMinForInput(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert an ISO string into a friendly Spanish date for previews. */
function formatScheduled(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-ES", {
      weekday: "long",
      day:     "2-digit",
      month:   "short",
      hour:    "2-digit",
      minute:  "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Format a total milliseconds duration into a human-readable Spanish string. */
function formatDuration(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec} segundos`;
  const totalMin = Math.ceil(totalSec / 60);
  if (totalMin < 60) return `${totalMin} minutos`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} horas`;
}

function sendButtonLabel(
  isEditing:    boolean,
  scheduleMode: "now" | "schedule",
  scheduledIso: string | null,
): string {
  if (isEditing)            return "Guardar cambios";
  if (scheduleMode === "now") return "Enviar ahora";
  if (scheduledIso)         return `Programar para ${formatScheduled(scheduledIso)}`;
  return "Programar";
}

/**
 * Translate a (maybe null) EditingBroadcast row into the initial
 * useState values for every field of the form. Falls back to defaults
 * when no row is supplied.
 */
function hydrateFromEditing(
  e:      EditingBroadcast | null | undefined,
  groups: Group[],
): {
  kind:             AudienceKind;
  status:           StudentStatus;
  level:            Level;
  groupId:          string;
  language:         LanguageChoice;
  leadStatusGroups: LeadStatusGroup[];
  leadLevels:       LeadLevel[];
  customEmails:     string;
  customPhones:     string;
  subject:          string;
  markdown:         string;
  emailOn:          boolean;
  whatsOn:          boolean;
  scheduleMode:     "now" | "schedule";
  scheduledLocal:   string;
  attachments:      Attachment[];
} {
  if (!e) {
    return {
      kind:             "all_students",
      status:           "active",
      level:            "B1",
      groupId:          groups[0]?.id ?? "",
      language:         "",
      leadStatusGroups: LEAD_STATUS_GROUPS_DEFAULT,
      leadLevels:       [],
      customEmails:     "",
      customPhones:     "",
      subject:          "",
      markdown:         "",
      emailOn:          true,
      whatsOn:          true,
      scheduleMode:     "now",
      scheduledLocal:   "",
      attachments:      [],
    };
  }
  const f = e.audience_filter as AudienceFilter & { _marker?: string };
  // Reverse-engineer the kind/status/level/group fields from the persisted filter.
  const kind: AudienceKind   = f.kind;
  const statusVal            = "status"   in f && f.status   ? f.status   : "active";
  const levelVal             = "level"    in f && f.level    ? f.level    : "B1";
  const groupIdVal           = "group_id" in f && f.group_id ? f.group_id : groups[0]?.id ?? "";
  const languageVal: LanguageChoice = ("language" in f && f.language) ? f.language : "";
  const leadGroupsVal: LeadStatusGroup[] =
    ("status_groups" in f && Array.isArray(f.status_groups))
      ? (f.status_groups as LeadStatusGroup[])
      : LEAD_STATUS_GROUPS_DEFAULT;
  const leadLevelsVal: LeadLevel[] =
    ("levels" in f && Array.isArray(f.levels))
      ? (f.levels as LeadLevel[])
      : [];
  const emails               = ("custom_emails" in f ? f.custom_emails ?? [] : []) as string[];
  const phones               = ("custom_phones" in f ? f.custom_phones ?? [] : []) as string[];

  return {
    kind,
    status:           statusVal as StudentStatus,
    level:            levelVal as Level,
    groupId:          groupIdVal,
    language:         languageVal,
    leadStatusGroups: leadGroupsVal,
    leadLevels:       leadLevelsVal,
    customEmails:     emails.join(", "),
    customPhones:     phones.join(", "),
    subject:          e.subject,
    markdown:         e.message_markdown,
    emailOn:          e.channels.includes("email"),
    whatsOn:          e.channels.includes("whatsapp"),
    scheduleMode:     "schedule",
    scheduledLocal:   isoToLocalInput(e.scheduled_at),
    attachments:      e.attachments ?? [],
  };
}

/** ISO UTC → "YYYY-MM-DDTHH:mm" in the browser's local timezone. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="padding-right:10px;vertical-align:middle;line-height:0;">
          <img src="https://b2c.aprender-aleman.de/Logonewwithbg.png"
               width="36" height="36" alt="Aprender-Aleman.de"
               style="border:0;display:block;border-radius:9px;">
        </td>
        <td style="vertical-align:middle;font-size:18px;font-weight:800;">Aprender-Aleman.de</td>
      </tr>
    </table>
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
