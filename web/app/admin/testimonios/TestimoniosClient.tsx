"use client";

import { useEffect, useState } from "react";

type Testimonial = {
  id: string;
  nombre_estudiante: string;
  audio_url: string;
  meta_tag: string;
  transcripcion: string | null;
  active: boolean;
  created_at: string;
};

const META_TAGS = [
  { value: "general",          label: "General (cualquier lead)" },
  { value: "work",             label: "Trabajo en Alemania" },
  { value: "studies",          label: "Estudios / Ausbildung" },
  { value: "pareja",           label: "Pareja / familia" },
  { value: "tiempo",           label: "Objeción: tiempo" },
  { value: "precio",           label: "Objeción: precio" },
  { value: "visa",             label: "Visa / ciudadanía" },
  { value: "travel",           label: "Viaje / día a día" },
  { value: "already_in_dach",  label: "Ya en DACH" },
];

export default function TestimoniosClient() {
  const [items, setItems] = useState<Testimonial[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedTag, setSelectedTag] = useState("general");
  const [transcripcion, setTranscripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/admin/testimonios");
    if (r.ok) setItems((await r.json()).items);
  }

  useEffect(() => { load(); }, []);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setMsg(null);
    const form = e.currentTarget;
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (!file) { setError("Elige un archivo"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("meta_tag", selectedTag);
      if (transcripcion.trim()) fd.append("transcripcion", transcripcion.trim());
      const r = await fetch("/api/admin/testimonios", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "upload_failed"); return; }
      setMsg(`Subido: ${j.nombre_estudiante}`);
      setTranscripcion("");
      fileInput.value = "";
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/admin/testimonios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    await load();
  }

  async function del(id: string) {
    if (!confirm("¿Eliminar este testimonio?")) return;
    await fetch(`/api/admin/testimonios/${id}`, { method: "DELETE" });
    await load();
  }

  async function updateTag(id: string, tag: string) {
    await fetch(`/api/admin/testimonios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta_tag: tag }),
    });
    await load();
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Testimonios en audio</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>
        Notas de voz de estudiantes reales respondiendo las 3 preguntas
        (antes / cambio / consejo). Se envían como social proof en las
        cadenas post-trial. El nombre del estudiante se toma del nombre
        del archivo.
      </p>

      <form onSubmit={onUpload} style={{ marginBottom: 32, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <h3 style={{ marginTop: 0 }}>Subir nuevo</h3>
        <div style={{ display: "grid", gap: 12 }}>
          <label>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Archivo audio (mp3, ogg, m4a — max 15 MB)</div>
            <input type="file" accept="audio/*" required />
          </label>
          <label>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Categoría (para matching con el lead)</div>
            <select value={selectedTag} onChange={e => setSelectedTag(e.target.value)}>
              {META_TAGS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Transcripción (opcional — solo para búsqueda interna)</div>
            <textarea value={transcripcion} onChange={e => setTranscripcion(e.target.value)} rows={3} style={{ width: "100%" }} />
          </label>
          <button type="submit" disabled={uploading} style={{ padding: "8px 16px", background: "#ea580c", color: "white", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
            {uploading ? "Subiendo…" : "Subir"}
          </button>
        </div>
        {error && <div style={{ color: "#dc2626", marginTop: 8 }}>Error: {error}</div>}
        {msg && <div style={{ color: "#059669", marginTop: 8 }}>{msg}</div>}
      </form>

      <h3>Testimonios ({items?.length ?? "…"})</h3>
      {!items && <p>Cargando…</p>}
      {items && items.length === 0 && <p style={{ color: "#64748b" }}>Aún no hay testimonios. Sube el primero arriba.</p>}
      {items && items.map(t => (
        <div key={t.id} style={{
          padding: 12, marginBottom: 12, background: t.active ? "#fff" : "#f1f5f9",
          border: "1px solid #e2e8f0", borderRadius: 8, opacity: t.active ? 1 : 0.6,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{t.nombre_estudiante}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                Subido: {new Date(t.created_at).toLocaleDateString("es-ES")}
              </div>
              <select value={t.meta_tag} onChange={e => updateTag(t.id, e.target.value)}
                      style={{ marginTop: 6, fontSize: 12 }}>
                {META_TAGS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
              {t.transcripcion && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#475569", fontStyle: "italic" }}>
                  {t.transcripcion.slice(0, 200)}{t.transcripcion.length > 200 ? "…" : ""}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
              <button onClick={() => toggle(t.id, t.active)}
                      style={{ padding: "6px 10px", fontSize: 12, background: t.active ? "#dbeafe" : "#059669", color: t.active ? "#1e40af" : "white", border: 0, borderRadius: 4, cursor: "pointer" }}>
                {t.active ? "Desactivar" : "Activar"}
              </button>
              <button onClick={() => del(t.id)}
                      style={{ padding: "6px 10px", fontSize: 12, background: "#fecaca", color: "#7f1d1d", border: 0, borderRadius: 4, cursor: "pointer" }}>
                Borrar
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
