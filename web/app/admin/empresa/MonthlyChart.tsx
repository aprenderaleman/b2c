"use client";

import { useState } from "react";
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import type { MonthlyRow } from "@/lib/empresa";

function money(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
}

function humanType(type: string): string {
  return ({ single_class: "Clase suelta", package: "Paquete", subscription_payment: "Suscripcion", other: "Otros" } as Record<string, string>)[type] ?? type;
}

export function MonthlyChart({ data }: { data: MonthlyRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const chartData = data.map((r) => ({
    name: r.label,
    ingresos: Math.round(r.revenue_cents / 100),
    ads: Math.round(r.ads_cents / 100),
    profes: Math.round(r.payroll_cents / 100),
    fijos: Math.round(r.fixed_cents / 100),
    neto: Math.round(r.neto_cents / 100),
    margen: Math.round(r.margen_neto_pct),
    roas: Math.round(r.roas * 10) / 10,
  }));

  return (
    <div className="space-y-6">
      {/* Chart: Margen neto % y ROAS */}
      <div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}x`}
            />
            <Tooltip
              formatter={(value, name) => [
                String(name) === "margen" ? `${value}%` : `${value}x`,
                String(name) === "margen" ? "Margen neto" : "ROAS",
              ]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="roas" yAxisId="right" fill="#f59e0b" radius={[3, 3, 0, 0]} barSize={24} opacity={0.7} />
            <Line
              type="monotone"
              dataKey="margen"
              yAxisId="left"
              stroke="#8b5cf6"
              strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 0 }}
            />
            <ReferenceLine yAxisId="left" y={30} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Obj 30%", fontSize: 10, fill: "#ef4444" }} />
            <ReferenceLine yAxisId="right" y={1} stroke="#10b981" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> Margen neto %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 opacity-70" /> ROAS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-6 border-t-2 border-dashed border-red-500" /> Objetivo 30%
          </span>
        </div>
      </div>

      {/* Monthly rows — expandable */}
      <div className="space-y-2">
        {data.map(row => {
          const isOpen = expanded === row.label;
          return (
            <div key={row.label} className={`rounded-xl border transition-colors ${row.neto_cents < 0 ? "border-red-200 dark:border-red-500/30 bg-red-50/30 dark:bg-red-500/5" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : row.label)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors"
              >
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-semibold text-sm w-16">{row.label}</span>
                <div className="flex-1 grid grid-cols-4 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-slate-400 mr-1">Ing:</span>
                    <span className="text-slate-900 dark:text-slate-100">{Math.round(row.revenue_cents / 100).toLocaleString("es-ES")}€</span>
                  </div>
                  <div>
                    <span className="text-slate-400 mr-1">Ads:</span>
                    <span className="text-red-500">{Math.round(row.ads_cents / 100).toLocaleString("es-ES")}€</span>
                  </div>
                  <div>
                    <span className="text-slate-400 mr-1">Neto:</span>
                    <span className={row.neto_cents >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      {Math.round(row.neto_cents / 100).toLocaleString("es-ES")}€
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span>
                      <span className="text-slate-400 mr-1">Margen:</span>
                      <span className={row.margen_neto_pct >= 30 ? "text-emerald-600 dark:text-emerald-400" : row.margen_neto_pct >= 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}>
                        {row.margen_neto_pct.toFixed(0)}%
                      </span>
                    </span>
                    <span>
                      <span className="text-slate-400 mr-1">ROAS:</span>
                      <span className={row.roas >= 3 ? "text-emerald-600 dark:text-emerald-400" : row.roas >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}>
                        {row.roas.toFixed(1)}x
                      </span>
                    </span>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    <MiniCard label="Ingresos" value={money(row.revenue_cents)} sub={`${row.payments_count} pagos · ${row.students_count} estudiantes`} />
                    <MiniCard label="Google Ads" value={money(row.ads_cents)} sub={`CPL: ${row.leads > 0 ? money(Math.round(row.ads_cents / row.leads)) : "—"}`} color="red" />
                    <MiniCard label="Nomina profesores" value={money(row.payroll_cents)} />
                    <MiniCard label="Costes fijos" value={money(row.fixed_cents)} />
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    <MiniCard label="Beneficio neto" value={money(row.neto_cents)} color={row.neto_cents >= 0 ? "green" : "red"} />
                    <MiniCard label="Margen neto" value={`${row.margen_neto_pct.toFixed(1)}%`} color={row.margen_neto_pct >= 30 ? "green" : row.margen_neto_pct >= 0 ? "amber" : "red"} />
                    <MiniCard label="Leads" value={String(row.leads)} sub={`${row.conversions} conversiones`} />
                    <MiniCard label="ROAS" value={`${row.roas.toFixed(2)}x`} color={row.roas >= 3 ? "green" : row.roas >= 1 ? "amber" : "red"} />
                  </div>

                  {/* Revenue by type */}
                  {Object.keys(row.revenue_by_type).length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">Ingresos por tipo</h4>
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(row.revenue_by_type).map(([type, cents]) => (
                          <span key={type} className="text-xs bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5 font-mono">
                            {humanType(type)}: <strong>{money(cents)}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payments table */}
                  {row.payments.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">Pagos ({row.payments.length})</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-slate-500 dark:text-slate-400">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">Estudiante</th>
                              <th className="px-2 py-1.5 font-medium">Tipo</th>
                              <th className="px-2 py-1.5 font-medium text-right">Monto</th>
                              <th className="px-2 py-1.5 font-medium text-right">Fecha</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                            {row.payments.map((p, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1.5">{p.student_name}</td>
                                <td className="px-2 py-1.5">{humanType(p.type)}</td>
                                <td className="px-2 py-1.5 text-right font-mono">{money(p.amount_cents)}</td>
                                <td className="px-2 py-1.5 text-right text-slate-500">
                                  {new Date(p.paid_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Totals row */}
        <div className="rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 flex items-center gap-3">
          <span className="w-4" />
          <span className="font-bold text-sm w-16">Total</span>
          <div className="flex-1 grid grid-cols-4 gap-2 text-xs font-mono font-semibold">
            <div>
              <span className="text-slate-400 mr-1">Ing:</span>
              <span>{Math.round(data.reduce((s, r) => s + r.revenue_cents, 0) / 100).toLocaleString("es-ES")}€</span>
            </div>
            <div>
              <span className="text-slate-400 mr-1">Ads:</span>
              <span>{Math.round(data.reduce((s, r) => s + r.ads_cents, 0) / 100).toLocaleString("es-ES")}€</span>
            </div>
            <div>
              {(() => { const n = data.reduce((s, r) => s + r.neto_cents, 0); return (
                <>
                  <span className="text-slate-400 mr-1">Neto:</span>
                  <span className={n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {Math.round(n / 100).toLocaleString("es-ES")}€
                  </span>
                </>
              ); })()}
            </div>
            <div>
              {(() => {
                const rev = data.reduce((s, r) => s + r.revenue_cents, 0);
                const net = data.reduce((s, r) => s + r.neto_cents, 0);
                const ads = data.reduce((s, r) => s + r.ads_cents, 0);
                return (
                  <>
                    <span className="text-slate-400 mr-1">Margen:</span>
                    <span>{rev > 0 ? (net / rev * 100).toFixed(0) : 0}%</span>
                    <span className="text-slate-400 mx-2">ROAS:</span>
                    <span>{ads > 0 ? (rev / ads).toFixed(1) : "—"}x</span>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: "red" | "green" | "amber" }) {
  const valueCls = color === "red" ? "text-red-600 dark:text-red-400"
    : color === "green" ? "text-emerald-600 dark:text-emerald-400"
    : color === "amber" ? "text-amber-600 dark:text-amber-400"
    : "text-slate-900 dark:text-slate-100";
  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-bold font-mono ${valueCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
