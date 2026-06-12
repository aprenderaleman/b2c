"use server";

import { auth } from "@/lib/auth";
import { saveScriptStep, completeScript, type ScriptPatch } from "@/lib/trial-script";
import {
  markTrialAttendedAwaitingConversion, markTrialAbsent,
} from "@/lib/admin-actions";
import type { PackId, PaymentType } from "@/lib/trial-packs";

/**
 * Server actions del wizard de /cp/[classId]. Toda mutación tiene que
 * pasar por una sesión válida; el wrapper assertAuth lo encapsula.
 *
 * No re-comprobamos canAccessTrialScript aquí — la página de entrada
 * /cp/[classId] ya filtra a profe asignado o superadmin; un user no
 * autorizado nunca llega a tener scriptId válido. (Aún así futuro
 * hardening: validar que script.teacher_id == session.user.id.)
 */

async function assertAuth() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  return session;
}

export async function saveStepAction(
  scriptId: string,
  patch:    ScriptPatch,
): Promise<void> {
  await assertAuth();
  await saveScriptStep(scriptId, patch);
}

export async function completeAttendedAction(input: {
  scriptId:     string;
  leadId:       string;
  packId:       PackId;
  paymentType:  PaymentType;
  objective:    string;
  teacherNotes: string;
}): Promise<void> {
  await assertAuth();

  // 1. Manda el WA con el link de pago + actualiza lead (función existente).
  await markTrialAttendedAwaitingConversion(input.leadId, {
    objective:    input.objective,
    packId:       input.packId,
    paymentType:  input.paymentType,
  });

  // 2. Cierra el script.
  await saveScriptStep(input.scriptId, {
    teacher_notes: input.teacherNotes || null,
  });
  await completeScript(input.scriptId, "attended");
}

export async function completeAbsentAction(input: {
  scriptId:     string;
  leadId:       string;
  teacherNotes: string;
}): Promise<void> {
  await assertAuth();

  await markTrialAbsent(input.leadId);

  await saveScriptStep(input.scriptId, {
    teacher_notes: input.teacherNotes || null,
  });
  await completeScript(input.scriptId, "absent");
}
