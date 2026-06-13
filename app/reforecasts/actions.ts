'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUserContext } from '../../lib/auth/session';
import {
  createDraftReforecast,
  lockReforecast,
  recalculateReforecast,
  transitionReforecastStatus
} from '../../lib/repositories/reforecasts';

function revalidateReforecasts(reforecastId?: string) {
  revalidatePath('/reforecasts');
  if (reforecastId) revalidatePath(`/reforecasts/${reforecastId}`);
}

export async function createReforecastAction(formData: FormData) {
  const context = await requireUserContext();
  const reforecastId = await createDraftReforecast(
    context,
    String(formData.get('budget_baseline_id') ?? ''),
    String(formData.get('reforecast_name') ?? ''),
    String(formData.get('reason') ?? '')
  );
  revalidateReforecasts(reforecastId);
  if (reforecastId) redirect(`/reforecasts/${reforecastId}`);
}

export async function recalculateReforecastAction(formData: FormData) {
  const context = await requireUserContext();
  const reforecastId = String(formData.get('reforecast_id') ?? '');
  await recalculateReforecast(context, reforecastId, String(formData.get('reason') ?? ''));
  revalidateReforecasts(reforecastId);
}

export async function transitionReforecastStatusAction(formData: FormData) {
  const context = await requireUserContext();
  const reforecastId = String(formData.get('reforecast_id') ?? '');
  await transitionReforecastStatus(context, reforecastId, String(formData.get('next_status') ?? ''), String(formData.get('reason') ?? ''));
  revalidateReforecasts(reforecastId);
}

export async function lockReforecastAction(formData: FormData) {
  const context = await requireUserContext();
  const reforecastId = String(formData.get('reforecast_id') ?? '');
  await lockReforecast(context, reforecastId, String(formData.get('reason') ?? ''));
  revalidateReforecasts(reforecastId);
}
