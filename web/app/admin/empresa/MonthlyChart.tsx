"use client";

import {
  BarChart,
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

export function MonthlyChart({ data }: { data: MonthlyRow[] }) {
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
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          Ingresos vs costes
        </h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                `${value.toLocaleString("es-ES")} EUR`,
                { ingresos: "Ingresos", ads: "Google Ads", profes: "Profesores", fijos: "Fijos", neto: "Neto" }[name] ?? name,
              ]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="ingresos" fill="#3b82f6" radius={[3, 3, 0, 0]} barSize={28} />
            <Bar dataKey="ads" fill="#ef4444" radius={[3, 3, 0, 0]} barSize={28} />
            <Bar dataKey="profes" fill="#94a3b8" radius={[3, 3, 0, 0]} barSize={28} />
            <Line
              type="monotone"
              dataKey="neto"
              stroke="#10b981"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Ingresos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Google Ads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-400" /> Profesores
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Neto
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          Margen neto % y ROAS
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}x`}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                name === "margen" ? `${value}%` : `${value}x`,
                name === "margen" ? "Margen neto" : "ROAS",
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
        </div>
      </div>
    </div>
  );
}
