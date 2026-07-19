/**
 * CSV export del waterfall + comparador de landings.
 *
 * ?days=30  ventana temporal (1-365, default 30)
 * ?landing= filtra a una landing_intent concreta
 *
 * Auth: solo admin/superadmin (mismo gate que /admin/funnel).
 * Devuelve text/csv con dos bloques separados por línea en blanco:
 *   1) Waterfall step-by-step
 *   2) Comparador por landing
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import {
  getWaterfall,
  getLandingComparator,
  WATERFALL_STEPS,
} from "@/lib/funnel-waterfall";

export const dynamic = "force-dynamic";

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  await requireRole(["superadmin", "admin"]);

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? 30);
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365
    ? Math.round(daysRaw) : 30;
  const landing = url.searchParams.get("landing")?.trim() || undefined;

  const [wf, landings] = await Promise.all([
    getWaterfall({ days, landingIntent: landing }),
    getLandingComparator(days),
  ]);

  const rows: string[] = [];
  rows.push(`# Funnel export — últimos ${days}d${landing ? ` · landing=${landing}` : ""}`);
  rows.push("");
  rows.push("## Waterfall");
  rows.push(["step_code", "step_key", "step_label", "sessions", "pct_of_start", "drop_from_prev_pct", "drop_count_from_prev"].join(","));
  for (const s of wf.steps) {
    rows.push([
      s.code, s.key, csvEscape(s.label),
      s.sessions,
      s.pctOfStart.toFixed(2),
      s.dropFromPrev !== null ? s.dropFromPrev.toFixed(2) : "",
      s.dropCountFromPrev !== null ? s.dropCountFromPrev : "",
    ].join(","));
  }

  rows.push("");
  rows.push("## Landings");
  rows.push(["landing_intent", "step10_landing_view", "step11_cta_click", "step12_slot_page", "step14_slot_picked", "step5_submit_attempt", "step6_submit_ok", "ctr_pct_10_to_11", "book_pct_10_to_6"].join(","));
  for (const l of landings) {
    rows.push([
      csvEscape(l.landingIntent),
      l.step10, l.step11, l.step12, l.step14, l.step5, l.step6,
      l.ctrPct.toFixed(2),
      l.bookPct.toFixed(2),
    ].join(","));
  }

  const filename = `funnel-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
  // Referencia labels para lint no-unused
  void WATERFALL_STEPS;

  return new NextResponse(rows.join("\n"), {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}
