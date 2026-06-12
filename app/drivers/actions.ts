'use server';

import { revalidatePath } from 'next/cache';
import { requireUserContext } from '../../lib/auth/session';

function valuesFrom(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) values[key] = value;
  return values;
}

export async function createDriverSetAction(formData: FormData) {
  const context = await requireUserContext();
  const { createBudgetDriverSetFromBaseline } = await import('../../lib/repositories/budget-drivers-mutations');
  await createBudgetDriverSetFromBaseline(context, valuesFrom(formData));
  revalidatePath('/drivers');
}

export async function createDriverAction(formData: FormData) {
  const context = await requireUserContext();
  const { createBudgetDriver } = await import('../../lib/repositories/budget-drivers-mutations');
  await createBudgetDriver(context, valuesFrom(formData));
  revalidatePath('/drivers');
}

export async function transitionDriverLifecycleAction(formData: FormData) {
  const context = await requireUserContext();
  const driverId = String(formData.get('driver_id') ?? '');
  const { transitionBudgetDriverLifecycle } = await import('../../lib/repositories/budget-drivers-mutations');
  await transitionBudgetDriverLifecycle(context, valuesFrom(formData));
  revalidatePath('/drivers');
  if (driverId) revalidatePath(`/drivers/${driverId}`);
}

export async function reviewDriverSetAction(formData: FormData) {
  const context = await requireUserContext();
  const { reviewBudgetDriverSet } = await import('../../lib/repositories/budget-drivers-mutations');
  await reviewBudgetDriverSet(context, String(formData.get('driver_set_id') ?? ''), String(formData.get('review_notes') ?? ''));
  revalidatePath('/drivers');
}
