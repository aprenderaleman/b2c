import { supabaseAdmin } from "./supabase";

export type CefrLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type SharedMaterial = {
  id:            string;
  level:         CefrLevel;
  module_name:   string | null;
  lesson_number: number | null;
  title:         string;
  subtitle:      string | null;
  gamma_url:     string;
  is_summary:    boolean;
};

const LEVEL_ORDER: CefrLevel[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Fetch every shared material, optionally filtered to a subset of levels.
 * Sorted by level → module → lesson_number; summaries go last within a level.
 */
export async function listSharedMaterials(levels?: CefrLevel[]): Promise<SharedMaterial[]> {
  const sb = supabaseAdmin();
  let q = sb.from("shared_materials").select("*").eq("active", true);
  if (levels && levels.length > 0) q = q.in("level", levels);
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as SharedMaterial[];
  return rows.sort((a, b) => {
    const la = LEVEL_ORDER.indexOf(a.level);
    const lb = LEVEL_ORDER.indexOf(b.level);
    if (la !== lb) return la - lb;
    // Summaries last within a level
    if (a.is_summary !== b.is_summary) return a.is_summary ? 1 : -1;
    // Same module first
    const ma = a.module_name ?? "";
    const mb = b.module_name ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    const na = a.lesson_number ?? 9999;
    const nb = b.lesson_number ?? 9999;
    return na - nb;
  });
}

/**
 * Which levels a student should see: their current level and every lower
 * one (for review/consolidation). C2 would see every level; A1 would see
 * only A1.
 */
export function levelsVisibleToStudent(currentLevel: CefrLevel): CefrLevel[] {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx < 0) return ["A1"];
  return LEVEL_ORDER.slice(0, idx + 1).filter(l => l !== "A0");
}
