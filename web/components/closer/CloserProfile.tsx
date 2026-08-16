"use client";

import { useState, useTransition } from "react";
import { GoogleCalendarConnectButton } from "@/components/calendar/GoogleCalendarConnectButton";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  rango: string | null;
  created_at: string;
};

export function CloserProfile({ profile }: { profile: Profile }) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingProfile, startProfile] = useTransition();

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pendingPw, startPw] = useTransition();

  const saveProfile = () => {
    setError(null);
    setSaved(false);
    startProfile(async () => {
      const res = await fetch("/api/closer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al guardar");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  const changePassword = () => {
    setPwError(null);
    setPwSaved(false);
    if (newPw.length < 8) { setPwError("Minimo 8 caracteres"); return; }
    if (newPw !== confirmPw) { setPwError("Las contrasenas no coinciden"); return; }
    startPw(async () => {
      const res = await fetch("/api/closer/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPwError(body?.message ?? body?.error ?? "Error al cambiar contrasena");
        return;
      }
      setPwSaved(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => setPwSaved(false), 3000);
    });
  };

  const rango = profile.rango ?? "rookie";
  const since = new Date(profile.created_at).toLocaleDateString("es", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Info card */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-2xl font-bold text-brand-600 dark:text-brand-400">
            {(profile.full_name ?? "C")[0].toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {profile.full_name ?? profile.email}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{profile.email}</p>
          </div>
        </div>
        <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-300">
          <span>Rango: <strong className="capitalize text-brand-600 dark:text-brand-400">{rango}</strong></span>
          <span>Desde: {since}</span>
        </div>
      </section>

      {/* Edit profile */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Datos personales
        </h2>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nombre completo</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-text mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Telefono</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-text mt-1"
            placeholder="+34 600 000 000"
          />
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Guardado correctamente</p>}
        <button onClick={saveProfile} disabled={pendingProfile} className="btn-primary">
          {pendingProfile ? "Guardando..." : "Guardar cambios"}
        </button>
      </section>

      {/* Google Calendar */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Google Calendar
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Vincula tu Google Calendar para que las Sesiones de Plan que agenden contigo se te añadan automáticamente en tu calendario personal.
        </p>
        <GoogleCalendarConnectButton basePath="/api/closer/google-calendar" />
      </section>

      {/* Change password */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Cambiar contrasena
        </h2>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Contrasena actual</span>
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="input-text mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nueva contrasena</span>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="input-text mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Confirmar nueva contrasena</span>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="input-text mt-1"
          />
        </label>
        {pwError && <p className="text-sm text-red-600 dark:text-red-400">{pwError}</p>}
        {pwSaved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Contrasena actualizada</p>}
        <button
          onClick={changePassword}
          disabled={pendingPw || !currentPw || !newPw || !confirmPw}
          className="btn-primary"
        >
          {pendingPw ? "Cambiando..." : "Cambiar contrasena"}
        </button>
      </section>
    </div>
  );
}
