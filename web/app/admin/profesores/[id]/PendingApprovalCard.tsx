"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Teacher = {
  id:                      string;
  full_name:               string | null;
  email:                   string;
  phone:                   string | null;
  address:                 string | null;
  country:                 string | null;
  languages_spoken:        string[];
  specialties:             string[];
  levels_taught:           string[];
  hourly_rate_group:       string | null;
  hourly_rate_individual:  string | null;
  iban:                    string | null;
  created_at:              string;
};

/**
 * Card amarilla grande que aparece arriba del perfil cuando un
 * profesor se auto-registró y aún no fue aprobado por admin.
 * Muestra los datos completos (más fáciles de revisar que dispersos
 * por la página) y los botones Aprobar / Rechazar.
 */
export function PendingApprovalCard({ teacher }: { teacher: Teacher }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [err,  setErr]  = useState<string | null>(null);
  const [done, setDone] = useState<null | { tempPassword: string | null; emailSent: boolean }>(null);

  async function approve() {
    if (!confirm(`Aprobar a ${teacher.full_name ?? teacher.email}?\n\nSe le enviará un email con su login y contraseña temporal.`)) return;
    setBusy("approve"); setErr(null);
    try {
      const res = await fetch(`/api/admin/teachers/${teacher.id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message ?? data.error ?? "No se pudo aprobar.");
        setBusy(null);
        return;
      }
      setDone({ tempPassword: data.tempPassword ?? null, emailSent: !!data.email_sent });
      // No refresh aún — dejamos que admin vea el confirm.
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión.");
      setBusy(null);
    }
  }

  async function reject() {
    if (!confirm(`Rechazar a ${teacher.full_name ?? teacher.email}?\n\nEsto BORRA su solicitud. La acción no se puede deshacer.`)) return;
    setBusy("reject"); setErr(null);
    try {
      const res = await fetch(`/api/admin/teachers/${teacher.id}/reject`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message ?? data.error ?? "No se pudo rechazar.");
        setBusy(null);
        return;
      }
      // Tras rechazar, ya no hay teacher — vuelvo al listado.
      router.push("/admin/profesores");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión.");
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-5">
        <h2 className="text-lg font-bold text-emerald-800 dark:text-emerald-200">
          ✓ Profesor aprobado
        </h2>
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
          {done.emailSent
            ? "Le enviamos un email con su login y contraseña temporal. Recarga para ver el perfil completo."
            : "No pudimos enviar el email. Contraseña temporal generada:"}
        </p>
        {done.tempPassword && (
          <div className="mt-3 rounded-lg bg-white dark:bg-slate-900 px-3 py-2 font-mono text-sm border border-emerald-300">
            {done.tempPassword}
          </div>
        )}
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-4 btn-primary text-sm"
        >
          Recargar perfil
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-amber-800 dark:text-amber-200">
            ⏳ Pendiente de aprobación
          </h2>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Este profesor se auto-registró el {new Date(teacher.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}. Revisa el perfil y decide.
          </p>
        </div>
      </div>

      <dl className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Kv k="Nombre"            v={teacher.full_name ?? "—"} />
        <Kv k="Email"             v={teacher.email}             mono />
        <Kv k="WhatsApp"          v={teacher.phone ?? "—"}      mono />
        <Kv k="País"              v={teacher.country ?? "—"} />
        <Kv k="Dirección"         v={teacher.address ?? "—"}    full />
        <Kv k="Idiomas"           v={teacher.languages_spoken.join(", ") || "—"} full />
        <Kv k="Especialidades"    v={teacher.specialties.join(", ") || "—"}      full />
        <Kv k="Niveles que enseña" v={teacher.levels_taught.join(", ") || "—"} />
        <Kv k="Tarifa grupal"     v={teacher.hourly_rate_group ? `${teacher.hourly_rate_group} €/h` : "—"} />
        <Kv k="Tarifa individual" v={teacher.hourly_rate_individual ? `${teacher.hourly_rate_individual} €/h` : "—"} />
        <Kv k="IBAN"              v={teacher.iban ?? "—"}        mono full />
      </dl>

      {err && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="mt-5 flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={approve}
          disabled={busy !== null}
          className="text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 disabled:opacity-60"
        >
          {busy === "approve" ? "Aprobando…" : "✓ Aprobar profesor"}
        </button>
        <button
          type="button"
          onClick={reject}
          disabled={busy !== null}
          className="text-sm font-semibold rounded-lg border border-red-300 text-red-700 hover:bg-red-50 px-4 py-2 disabled:opacity-60"
        >
          {busy === "reject" ? "Rechazando…" : "✗ Rechazar"}
        </button>
      </div>
    </div>
  );
}

function Kv({ k, v, mono = false, full = false }: { k: string; v: string; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">{k}</dt>
      <dd className={`text-sm text-slate-900 dark:text-slate-100 ${mono ? "font-mono break-all" : ""}`}>{v}</dd>
    </div>
  );
}
