'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUserContext } from '../../lib/auth/session';
import {
  createDraftActualsBatch,
  supersedeActualsBatch,
  transitionActualsBatchStatus,
  updateDraftActualsBatch,
  type ManualActualsRow
} from '../../lib/repositories/actuals';

function revalidateActuals(batchId?: string) {
  revalidatePath('/actuals');
  if (batchId) revalidatePath(`/actuals/${batchId}`);
}

function manualRowsFromForm(formData: FormData): ManualActualsRow[] {
  const rows: ManualActualsRow[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('cost_')) continue;
    const periodId = key.slice('cost_'.length);
    const cost = String(value ?? '').trim();
    const fte = String(formData.get(`fte_${periodId}`) ?? '').trim();
    const hours = String(formData.get(`hours_${periodId}`) ?? '').trim();
    if (cost === '' && fte === '' && hours === '') continue;
    rows.push({
      planningPeriodId: periodId,
      actualCost: cost === '' ? 0 : Number(cost),
      actualFte: fte === '' ? 0 : Number(fte),
      actualWorkloadHours: hours === '' ? 0 : Number(hours)
    });
  }
  return rows;
}

export async function createActualsBatchAction(formData: FormData) {
  const context = await requireUserContext();
  const batchId = await createDraftActualsBatch(
    context,
    String(formData.get('baseline_id') ?? ''),
    String(formData.get('reforecast_id') ?? '') || null,
    String(formData.get('batch_name') ?? ''),
    { sourceType: 'csv', csvText: String(formData.get('csv_text') ?? '') },
    String(formData.get('reason') ?? '')
  );
  revalidateActuals(batchId);
  if (batchId) redirect(`/actuals/${batchId}`);
}

export async function updateActualsBatchAction(formData: FormData) {
  const context = await requireUserContext();
  const batchId = String(formData.get('actuals_batch_id') ?? '');
  await updateDraftActualsBatch(
    context,
    batchId,
    { sourceType: 'manual', rows: manualRowsFromForm(formData) },
    String(formData.get('reason') ?? '')
  );
  revalidateActuals(batchId);
}

export async function transitionActualsBatchStatusAction(formData: FormData) {
  const context = await requireUserContext();
  const batchId = String(formData.get('actuals_batch_id') ?? '');
  await transitionActualsBatchStatus(context, batchId, String(formData.get('next_status') ?? ''), String(formData.get('reason') ?? ''));
  revalidateActuals(batchId);
}

export async function supersedeActualsBatchAction(formData: FormData) {
  const context = await requireUserContext();
  const batchId = String(formData.get('actuals_batch_id') ?? '');
  const replacementId = await supersedeActualsBatch(
    context,
    batchId,
    String(formData.get('batch_name') ?? ''),
    { sourceType: 'manual', rows: manualRowsFromForm(formData) },
    String(formData.get('reason') ?? '')
  );
  revalidateActuals(batchId);
  if (replacementId) redirect(`/actuals/${replacementId}`);
}
