'use server';

import { revalidatePath } from 'next/cache';
import { requireUserContext } from '../../lib/auth/session';
import {
  createBudgetBaselineFromLayer1Handoff,
  createManualBudgetBaseline,
  lockBudgetBaseline,
  markBudgetBaselineReviewed,
  updateBudgetBaselinePhasing
} from '../../lib/repositories/budget-baselines';

function valuesFrom(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) values[key] = value;
  return values;
}

function revalidateBaseline(baselineId?: string) {
  revalidatePath('/baseline');
  if (baselineId) revalidatePath(`/baseline/${baselineId}`);
}

export async function createBaselineFromHandoffAction(formData: FormData) {
  const context = await requireUserContext();
  await createBudgetBaselineFromLayer1Handoff(context, valuesFrom(formData));
  revalidateBaseline();
}

export async function createManualBaselineAction(formData: FormData) {
  const context = await requireUserContext();
  await createManualBudgetBaseline(context, valuesFrom(formData));
  revalidateBaseline();
}

export async function updateBaselinePhasingAction(formData: FormData) {
  const context = await requireUserContext();
  const baselineId = String(formData.get('budget_baseline_id') ?? '');
  await updateBudgetBaselinePhasing(context, {
    baselineId,
    lineIds: formData.getAll('line_id').map(String),
    workloadHours: formData.getAll('workload_hours').map(String),
    requiredFte: formData.getAll('required_fte').map(String),
    supplyGapFte: formData.getAll('supply_gap_fte').map(String),
    labourCost: formData.getAll('labour_cost').map(String),
    budgetAmount: formData.getAll('budget_amount').map(String),
    notes: String(formData.get('phasing_notes') ?? '')
  });
  revalidateBaseline(baselineId);
}

export async function markBaselineReviewedAction(formData: FormData) {
  const context = await requireUserContext();
  const baselineId = String(formData.get('budget_baseline_id') ?? '');
  await markBudgetBaselineReviewed(context, baselineId, String(formData.get('review_notes') ?? ''));
  revalidateBaseline(baselineId);
}

export async function lockBaselineAction(formData: FormData) {
  const context = await requireUserContext();
  const baselineId = String(formData.get('budget_baseline_id') ?? '');
  await lockBudgetBaseline(context, baselineId, String(formData.get('lock_notes') ?? ''));
  revalidateBaseline(baselineId);
}
