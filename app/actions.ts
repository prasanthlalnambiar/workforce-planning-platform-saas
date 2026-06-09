'use server';

import { revalidatePath } from 'next/cache';
import { createPlan } from '../lib/repositories/plans';
import { createFiscalYearWithPeriods } from '../lib/repositories/fiscal-years';
import { createDimension } from '../lib/repositories/dimensions';
import { isDimensionTable } from '../lib/repositories/dimension-tables';
import { requireUserContext } from '../lib/auth/session';

export async function createPlanAction(formData: FormData) {
  const context = await requireUserContext();
  await createPlan(context, {
    planName: String(formData.get('plan_name') ?? ''),
    description: String(formData.get('plan_description') ?? '')
  });
  revalidatePath('/workspace');
}

export async function createFiscalYearAction(formData: FormData) {
  const context = await requireUserContext();
  await createFiscalYearWithPeriods(context, {
    planId: String(formData.get('plan_id') ?? ''),
    label: String(formData.get('fiscal_year_label') ?? ''),
    startDate: String(formData.get('start_date') ?? '')
  });
  revalidatePath('/fiscal-years');
}

export async function createDimensionAction(formData: FormData) {
  const context = await requireUserContext();
  const tableValue = String(formData.get('dimension_table') ?? '');
  if (!isDimensionTable(tableValue)) {
    throw new Error('Invalid dimension table');
  }

  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key !== 'dimension_table') values[key] = value;
  }
  await createDimension(context, tableValue, values);
  revalidatePath('/dimensions');
}
