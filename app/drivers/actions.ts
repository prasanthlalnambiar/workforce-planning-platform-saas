'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUserContext } from '../../lib/auth/session';
import {
  createForecastDriver,
  supersedeForecastDriver,
  transitionForecastDriverStatus,
  updateForecastDriverDraft
} from '../../lib/repositories/forecast-drivers';

function valuesFrom(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) values[key] = value;
  return values;
}

function revalidateDrivers(driverId?: string) {
  revalidatePath('/drivers');
  if (driverId) revalidatePath(`/drivers/${driverId}`);
}

export async function createDriverAction(formData: FormData) {
  const context = await requireUserContext();
  const driverId = await createForecastDriver(context, valuesFrom(formData));
  revalidateDrivers(driverId);
  if (driverId) redirect(`/drivers/${driverId}`);
}

export async function updateDriverDraftAction(formData: FormData) {
  const context = await requireUserContext();
  const driverId = String(formData.get('forecast_driver_id') ?? '');
  await updateForecastDriverDraft(context, driverId, valuesFrom(formData));
  revalidateDrivers(driverId);
}

export async function transitionDriverStatusAction(formData: FormData) {
  const context = await requireUserContext();
  const driverId = String(formData.get('forecast_driver_id') ?? '');
  const nextStatus = String(formData.get('next_status') ?? '');
  await transitionForecastDriverStatus(context, driverId, nextStatus, String(formData.get('reason') ?? ''));
  revalidateDrivers(driverId);
}

export async function supersedeDriverAction(formData: FormData) {
  const context = await requireUserContext();
  const driverId = String(formData.get('forecast_driver_id') ?? '');
  const replacementId = await supersedeForecastDriver(context, driverId, valuesFrom(formData));
  revalidateDrivers(driverId);
  if (replacementId) redirect(`/drivers/${replacementId}`);
}
