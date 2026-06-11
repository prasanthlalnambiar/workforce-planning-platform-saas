'use server';

import { revalidatePath } from 'next/cache';
import { requireUserContext } from '../../lib/auth/session';
import { createBudgetDriver, createBudgetDriverSetFromBaseline, reviewBudgetDriverSet, transitionBudgetDriverLifecycle } from '../../lib/repositories/budget-drivers';

function valuesFrom(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) values[key] = value;
  return values;
}

export async function createDriverSetAction(formData: FormData) {
  const context = await requireUserContext();
  await createBudgetDriverSetFromBaseline(context, valuesFrom(formData));
  revalidatePath('/drivers');
}

export async function createDriverAction(formData: FormData) {
  const context = await requireUserContext();
  await createBudgetDriver(context, valuesFrom(formData));
  revalidatePath('/drivers');
}

export async function transitionDriverLifecycleAction(formData: FormData) {
  const context = await requireUserContext();
  const driverId = String(formData.get('driver_id') ?? '');
  await transitionBudgetDriverLifecycle(context, valuesFrom(formData));
  revalidatePath('/drivers');
  if (driverId) revalidatePath(`/drivers/${driverId}`);
}

export async function reviewDriverSetAction(formData: FormData) {
  const context = await requireUserContext();
  await reviewBudgetDriverSet(context, String(formData.get('driver_set_id') ?? ''), String(formData.get('review_notes') ?? ''));
  revalidatePath('/drivers');
}
