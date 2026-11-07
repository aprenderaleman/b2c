/** Gelfis 2026-11-08: profes regulares al 10 % desde noviembre; recálculo de Simon. */
import { supabaseAdmin } from "@/lib/supabase";
const GELFIS = "889df284-dd16-41f3-a17c-64417524bbd8";
const SIMON_T = "42aa943a-d305-420f-83bb-da0f68df6b7f";
(async () => {
  const sb = supabaseAdmin();
  // 1. Rango pro (10 %) a Sabine, Simon, Veronica
  const { data: regs } = await sb.from("teachers").select("id, user_id, users!inner(full_name, rango)").in("id", [
    "72d93d60-a9b2-43f0-9507-36e8d26da4ed", SIMON_T, "6b4c894e-05dc-4008-9be9-8fd53767a73a"]);
  for (const t of (regs ?? []) as Array<{ id: string; user_id: string; users: { full_name: string; rango: string | null } | Array<{ full_name: string; rango: string | null }> }>) {
    const u = Array.isArray(t.users) ? t.users[0] : t.users;
    const { error } = await sb.from("users").update({ rango: "pro" }).eq("id", t.user_id);
    if (error) throw error;
    await sb.from("admin_notes").insert({ target_type: "teacher", target_id: t.id, author_id: GELFIS,
      content: `[2026-11-08] Rango ${u.rango ?? "starter"} → Pro (10 %): comisión de profes regulares al 10 % desde noviembre 2026 (Gelfis).` });
    console.log(u.full_name, u.rango, "→ pro");
  }
  // 2. Recalcular las conversiones de Simon de noviembre al 10 %
  const { data: rows } = await sb.from("comisiones").select("id, base_amount_cents, monto_cents, comision_pct, student_id")
    .eq("usuario_id", "cf79c97d-cea9-4750-9319-d9467f382670".length ? (await sb.from("teachers").select("user_id").eq("id", SIMON_T).single()).data!.user_id : "")
    .eq("tipo", "conversion").eq("mes", "2026-11-01").eq("pagado", false);
  for (const r of (rows ?? []) as Array<{ id: string; base_amount_cents: number; monto_cents: number; comision_pct: number; student_id: string }>) {
    const nuevo = Math.round(r.base_amount_cents * 0.10);
    const { error } = await sb.from("comisiones").update({ comision_pct: 10, monto_cents: nuevo }).eq("id", r.id);
    if (error) throw error;
    console.log("comisión", r.id, r.monto_cents / 100, "€ →", nuevo / 100, "€ (base", r.base_amount_cents / 100, "€)");
  }
  const { error: rpcErr } = await sb.rpc("recompute_teacher_month", { p_teacher_id: SIMON_T, p_any_date_in_month: "2026-11-08T00:00:00Z" });
  console.log("recompute:", rpcErr ?? "ok");
  const { data: check } = await sb.from("comisiones").select("tipo, comision_pct, monto_cents").eq("mes", "2026-11-01").eq("usuario_id", (await sb.from("teachers").select("user_id").eq("id", SIMON_T).single()).data!.user_id);
  console.log(check);
})().catch(e => { console.error(e); process.exit(1); });
