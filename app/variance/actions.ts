'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUserContext } from '../../lib/auth/session';
import {
  createVarianceReport,
  lockVarianceReport,
  recalculateVarianceReport,
  voidVarianceReport
} from '../../lib/repositories/variance';

function revalidateVariance(reportId?: string) {
  revalidatePath('/variance');
  if (reportId) revalidatePath(`/variance/${reportId}`);
}

export async function createVarianceReportAction(formData: FormData) {
  const context = await requireUserContext();
  const reportId = await createVarianceReport(
    context,
    String(formData.get('actuals_batch_id') ?? ''),
    String(formData.get('reforecast_id') ?? ''),
    String(formData.get('report_name') ?? ''),
    String(formData.get('reason') ?? '')
  );
  revalidateVariance(reportId);
  if (reportId) redirect(`/variance/${reportId}`);
}

export async function recalculateVarianceReportAction(formData: FormData) {
  const context = await requireUserContext();
  const reportId = String(formData.get('variance_report_id') ?? '');
  await recalculateVarianceReport(context, reportId, String(formData.get('reason') ?? ''));
  revalidateVariance(reportId);
}

export async function lockVarianceReportAction(formData: FormData) {
  const context = await requireUserContext();
  const reportId = String(formData.get('variance_report_id') ?? '');
  await lockVarianceReport(context, reportId, String(formData.get('reason') ?? ''));
  revalidateVariance(reportId);
}

export async function voidVarianceReportAction(formData: FormData) {
  const context = await requireUserContext();
  const reportId = String(formData.get('variance_report_id') ?? '');
  await voidVarianceReport(context, reportId, String(formData.get('reason') ?? ''));
  revalidateVariance(reportId);
}
