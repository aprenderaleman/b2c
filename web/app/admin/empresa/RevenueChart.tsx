"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import type { DailyDataPoint } from "@/lib/empresa";

export function RevenueChart({ data }: { data: DailyDataPoint[] }) {
  const chartData = data.map(d => ({
    date: d.date.slice(5),
    leads: d.leads,
    revenue: d.revenue_cents / 100,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
          Leads por dia
        </h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-200, #e2e8f0)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--color-slate-400, #94a3b8)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--color-slate-400, #94a3b8)" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-slate-900, #0f172a)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="leads" fill="#f97316" radius={[4, 4, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
          Ingresos diarios (EUR)
        </h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-200, #e2e8f0)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--color-slate-400, #94a3b8)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--color-slate-400, #94a3b8)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-slate-900, #0f172a)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: 12,
                }}
                formatter={(v) => [`${Number(v).toFixed(2)} EUR`, "Ingresos"]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#10b981"
                fill="url(#revenueGradient)"
                strokeWidth={2}
                name="Ingresos"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
