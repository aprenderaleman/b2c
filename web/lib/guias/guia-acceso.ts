import { supabaseAdmin } from "@/lib/supabase";
import { guiaDisponible } from "./primeras-frases";

/** ¿Este alumno ganó la guía? Lee su conversión y la clase de prueba de su lead. */
export async function alumnoTieneGuia(studentId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data: s } = await sb
    .from("students")
    .select("converted_at, bono_conversacion_at, lead_id")
    .eq("id", studentId)
    .maybeSingle();
  const st = s as { converted_at: string | null; bono_conversacion_at: string | null; lead_id: string | null } | null;
  if (!st) return false;
  if (st.bono_conversacion_at) return true;
  if (!st.lead_id) return false;

  const { data: l } = await sb
    .from("leads")
    .select("trial_attended_at, trial_scheduled_at")
    .eq("id", st.lead_id)
    .maybeSingle();
  const lead = l as { trial_attended_at: string | null; trial_scheduled_at: string | null } | null;
  return guiaDisponible({
    convertedAt: st.converted_at,
    attendedAt:  lead?.trial_attended_at ?? null,
    scheduledAt: lead?.trial_scheduled_at ?? null,
  });
}
