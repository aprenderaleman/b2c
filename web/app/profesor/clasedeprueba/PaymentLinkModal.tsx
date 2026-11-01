"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RITMOS,
  ONE_TIME_PACKS,
  type RitmoId,
  type GoalId,
} from "@/lib/trial-packs";
import {
  GROUP_FORMAT_LABELS, GROUP_LEVELS, GROUP_PRICES, GROUP_SESSIONS,
  buildGroupUrl, renderGroupOfferMessage,
  type GroupFormat, type GroupLevelId, type GroupRitmo,
} from "@/lib/group-packs";

type PaymentMode = "flexible" | "unico" | "duo" | "trio";

const GOALS: { id: GoalId; label: string; emoji: string }[] = [
  { id: "a1_a2",         label: "A1-A2",         emoji: "🇩🇪" },
  { id: "b1",            label: "B1",             emoji: "📗" },
  { id: "b2",            label: "B2",             emoji: "📘" },
  { id: "c1",            label: "C1",             emoji: "📕" },
  { id: "fluidez_total", label: "Fluidez Total",  emoji: "🏆" },
];

export function PaymentLinkModal({
  leadId,
  leadName,
  endpointUrl,
  onClose,
}: {
  leadId: string;
  leadName: string;
  defaultLevel?: string;
  endpointUrl?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [goalId, setGoalId] = useState<GoalId>("a1_a2");
  const [ritmoId, setRitmoId] = useState<RitmoId>("viajero");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("flexible");

  // Dúo / Trío (Gelfis 2026-10-31): nivel y ritmo SIN preselección — el
  // botón Enviar queda deshabilitado hasta elegir ambos. El mensaje se
  // genera de plantilla y es editable (preview obligatoria).
  const isGroup = paymentMode === "duo" || paymentMode === "trio";
  const [groupLvl, setGroupLvl]     = useState<GroupLevelId | null>(null);
  const [groupRitmo, setGroupRitmo] = useState<GroupRitmo | null>(null);
  const [groupMsg, setGroupMsg]     = useState("");

  useEffect(() => {
    if (!isGroup || !groupLvl || !groupRitmo) { setGroupMsg(""); return; }
    setGroupMsg(renderGroupOfferMessage({
      leadName: leadName,
      format:   paymentMode as GroupFormat,
      lvl:      groupLvl,
      r:        groupRitmo,
      url:      buildGroupUrl(paymentMode as GroupFormat, groupLvl, groupRitmo, leadId),
    }));
    // Regenera al cambiar formato/nivel/ritmo (pisa ediciones a propósito:
    // el precio y el enlace deben corresponder SIEMPRE a la selección).
  }, [isGroup, paymentMode, groupLvl, groupRitmo, leadId, leadName]);

  const selectedRitmo = RITMOS.find(r => r.id === ritmoId)!;
  const selectedGoal = selectedRitmo.goals.find(g => g.id === goalId)!;
  const selectedOneTime = ONE_TIME_PACKS.find(p => p.id === goalId);

  const summary = (() => {
    if (paymentMode === "flexible" && selectedGoal) {
      return {
        detail: `${selectedRitmo.classesPerMonth} clases/mes · Meta ${selectedGoal.label} en ${selectedGoal.months} meses`,
        price: `${selectedRitmo.pricePerMonth}€/mes`,
      };
    }
    if (paymentMode === "unico" && selectedOneTime) {
      return {
        detail: `Meta ${selectedOneTime.name}`,
        price: `Pago unico: ${(selectedOneTime.priceCents / 100).toLocaleString("es-ES")}€`,
      };
    }
    return null;
  })();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const body = isGroup
          ? { category: "grupo", format: paymentMode, lvl: groupLvl, r: groupRitmo, message: groupMsg }
          : paymentMode === "flexible"
          ? { category: "subscription", ritmoId, goalId }
          : { category: "one_time", goalId };

        const res = await fetch(endpointUrl ?? `/api/teacher/trial/${leadId}/send-offer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        setSent(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al enviar enlace.");
      }
    });
  };

  if (sent) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6">
          <div className="text-center py-6">
            <div className="text-4xl mb-3">✅</div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
              Enlace enviado
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {leadName} recibio el enlace de inscripcion por WhatsApp y email.
            </p>
            <button
              onClick={onClose}
              className="btn-primary mt-5"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] overflow-y-auto">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Enviar enlace de inscripcion
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {leadName} recibira el enlace de Stripe por WhatsApp y email.
          </p>
        </header>

        <div className="p-6 space-y-5">
          {/* 1. Meta / Goal — no aplica a Dúo/Trío (tienen su propio nivel) */}
          {!isGroup && (
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Meta
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {GOALS.map(({ id, label, emoji }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGoalId(id)}
                  className={`text-sm font-semibold rounded-xl border px-4 py-2 transition-colors ${
                    goalId === id
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {emoji} {label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* 2. Tipo de pago / formato */}
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Tipo
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                { id: "flexible" as const, label: "Suscripcion mensual", emoji: "📅" },
                { id: "unico" as const,    label: "Pago unico",         emoji: "💳" },
                { id: "duo" as const,      label: "Dúo",                emoji: "👥" },
                { id: "trio" as const,     label: "Trío",               emoji: "👨‍👩‍👧" },
              ]).map(({ id, label, emoji }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPaymentMode(id)}
                  className={`text-sm font-semibold rounded-xl border px-4 py-2 transition-colors ${
                    paymentMode === id
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {emoji} {label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Ritmo — solo para suscripcion */}
          {paymentMode === "flexible" && (
            <div className="space-y-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 p-4">
              <Field label="Ritmo">
                <select
                  value={ritmoId}
                  onChange={(e) => setRitmoId(e.target.value as RitmoId)}
                  className="input-text"
                >
                  {RITMOS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.emoji} {r.name} ({r.classesPerMonth} cls/mes — {r.pricePerMonth}€/mes)
                    </option>
                  ))}
                </select>
              </Field>

              {summary && (
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  <p>{summary.detail}</p>
                  <p className="font-semibold">{summary.price}</p>
                </div>
              )}
            </div>
          )}

          {/* Dúo / Trío: nivel + ritmo + preview editable */}
          {isGroup && (
            <div className="space-y-4 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/50 dark:bg-violet-500/5 p-4">
              <p className="text-xs text-violet-700 dark:text-violet-300">
                {paymentMode === "duo" ? "2 alumnos" : "3 alumnos"} · un profesor fijo · sesiones de 90 min.
                El lead paga su parte y reenvía el mismo enlace a {paymentMode === "duo" ? "su pareja o compañero/a" : "sus compañeros/as"} — quedan emparejados automáticamente.
              </p>
              <div>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nivel</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GROUP_LEVELS.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setGroupLvl(id)}
                      className={`text-sm font-semibold rounded-xl border px-3 py-1.5 transition-colors ${
                        groupLvl === id
                          ? "border-violet-400 bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-200"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Ritmo</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([2, 3, 4] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setGroupRitmo(r)}
                      className={`text-sm font-semibold rounded-xl border px-4 py-1.5 transition-colors ${
                        groupRitmo === r
                          ? "border-violet-400 bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-200"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                    >
                      {r}/sem
                    </button>
                  ))}
                </div>
              </div>
              {groupLvl && groupRitmo && (
                <>
                  <div className="text-xs text-violet-700 dark:text-violet-300 font-semibold">
                    {GROUP_PRICES[paymentMode as GroupFormat][groupLvl][groupRitmo]} €/mes/persona · {GROUP_SESSIONS[groupLvl]} sesiones de 90 min
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      Mensaje que recibirá {leadName} (puedes editarlo)
                    </span>
                    <textarea
                      value={groupMsg}
                      onChange={e => setGroupMsg(e.target.value)}
                      rows={11}
                      className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs text-slate-800 dark:text-slate-100 font-mono leading-relaxed"
                    />
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      El enlace se genera solo y debe permanecer en el mensaje. Si cambias nivel o ritmo, el texto se regenera.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Pago unico summary */}
          {paymentMode === "unico" && summary && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-4">
              <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
                <p>{summary.detail}</p>
                <p className="font-semibold">{summary.price}</p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            onClick={submit}
            disabled={pending || (isGroup && (!groupLvl || !groupRitmo || !groupMsg.includes("aprender-aleman.de/g/")))}
          >
            {pending ? "Enviando…" : "Enviar enlace"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: {
  label: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
