import { supabaseAdmin } from "./supabase";

type RangoConfig = {
  rango: string;
  comision_pct: number;
  min_close_rate: number;
  min_conversiones: number;
};

export type RankEntry = {
  user_id: string;
  full_name: string;
  rango: string;
  close_rate: number;
  conversiones: number;
  comision_pct: number;
};

export async function recalculateRank(
  userId: string,
  rol: "teacher" | "closer",
): Promise<{ oldRank: string | null; newRank: string; changed: boolean }> {
  const sb = supabaseAdmin();

  const { data: rangos } = await sb
    .from("config_rangos")
    .select("rango, comision_pct, min_close_rate, min_conversiones")
    .eq("rol", rol)
    .order("comision_pct", { ascending: false });

  const rangosList = (rangos ?? []) as RangoConfig[];
  if (rangosList.length === 0) {
    return { oldRank: null, newRank: "starter", changed: false };
  }

  const { closeRate, conversiones } = await getUserMetrics(userId, rol);

  let newRango = rangosList[rangosList.length - 1].rango;
  for (const r of rangosList) {
    if (closeRate >= r.min_close_rate && conversiones >= r.min_conversiones) {
      newRango = r.rango;
      break;
    }
  }

  const { data: user } = await sb
    .from("users")
    .select("rango")
    .eq("id", userId)
    .single();

  const oldRank = (user?.rango as string | null) ?? null;
  const changed = oldRank !== newRango;

  if (changed) {
    await sb.from("users").update({ rango: newRango }).eq("id", userId);
  }

  return { oldRank, newRank: newRango, changed };
}

async function getUserMetrics(
  userId: string,
  rol: "teacher" | "closer",
): Promise<{ closeRate: number; conversiones: number }> {
  const sb = supabaseAdmin();

  if (rol === "closer") {
    const { data: leads } = await sb
      .from("leads")
      .select("id, estado_cierre")
      .eq("closer_id", userId);

    const all = (leads ?? []) as Array<{ estado_cierre: string }>;
    const total = all.length;
    const convertidos = all.filter((l) => l.estado_cierre === "convertido").length;
    return {
      closeRate: total > 0 ? (convertidos / total) * 100 : 0,
      conversiones: convertidos,
    };
  }

  // Teacher: contar trials atendidas vs convertidas (all time)
  const { data: trialClasses } = await sb
    .from("classes")
    .select("lead_id")
    .eq("teacher_id", userId)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"]);

  const leadIds = (trialClasses ?? [])
    .map((t: { lead_id: string | null }) => t.lead_id)
    .filter((id): id is string => !!id);

  if (leadIds.length === 0) return { closeRate: 0, conversiones: 0 };

  const uniqueLeads = [...new Set(leadIds)];

  const { data: converted } = await sb
    .from("leads")
    .select("id")
    .in("id", uniqueLeads)
    .not("converted_at", "is", null);

  const conversiones = (converted ?? []).length;
  const closeRate = (conversiones / uniqueLeads.length) * 100;

  return { closeRate, conversiones };
}

export async function recalculateAllRanks(): Promise<{
  teachers: number;
  closers: number;
}> {
  const sb = supabaseAdmin();
  let teacherChanges = 0;
  let closerChanges = 0;

  const { data: teachers } = await sb
    .from("users")
    .select("id")
    .eq("role", "teacher")
    .eq("active", true);

  for (const t of (teachers ?? []) as Array<{ id: string }>) {
    const result = await recalculateRank(t.id, "teacher");
    if (result.changed) teacherChanges++;
  }

  const { data: closers } = await sb
    .from("users")
    .select("id")
    .eq("role", "closer")
    .eq("active", true);

  for (const c of (closers ?? []) as Array<{ id: string }>) {
    const result = await recalculateRank(c.id, "closer");
    if (result.changed) closerChanges++;
  }

  return { teachers: teacherChanges, closers: closerChanges };
}

export async function getRankingTable(
  rol: "teacher" | "closer",
): Promise<RankEntry[]> {
  const sb = supabaseAdmin();

  const roleValue = rol === "teacher" ? "teacher" : "closer";
  const { data: users } = await sb
    .from("users")
    .select("id, full_name, rango")
    .eq("role", roleValue)
    .eq("active", true);

  const { data: rangos } = await sb
    .from("config_rangos")
    .select("rango, comision_pct")
    .eq("rol", rol);

  const rangoMap = new Map(
    ((rangos ?? []) as Array<{ rango: string; comision_pct: number }>).map((r) => [
      r.rango,
      r.comision_pct,
    ]),
  );

  const entries: RankEntry[] = [];
  for (const u of (users ?? []) as Array<{ id: string; full_name: string; rango: string | null }>) {
    const metrics = await getUserMetrics(u.id, rol);
    entries.push({
      user_id: u.id,
      full_name: u.full_name ?? "",
      rango: u.rango ?? (rol === "teacher" ? "starter" : "rookie"),
      close_rate: Math.round(metrics.closeRate * 100) / 100,
      conversiones: metrics.conversiones,
      comision_pct: rangoMap.get(u.rango ?? "") ?? 0,
    });
  }

  entries.sort((a, b) => b.close_rate - a.close_rate);
  return entries;
}
