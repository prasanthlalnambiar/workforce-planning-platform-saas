import { insertAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../permissions/permissions';
import { generateMonthlyPlanningPeriods } from '../services/planning-periods';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function listFiscalYears(context: UserContext) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fiscal_years')
    .select('id, organisation_id, plan_id, fiscal_year_label, start_date, end_date, status, created_at')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listPlanningPeriods(context: UserContext) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('planning_periods')
    .select('id, organisation_id, fiscal_year_id, period_number, period_start, period_end, period_label, status, editable')
    .eq('organisation_id', context.organisationId)
    .order('period_start', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createFiscalYearWithPeriods(
  context: UserContext,
  input: { planId: string; label: string; startDate: string }
) {
  requirePermission(context.roles, 'fiscal_year:write');
  const supabase = await createClient();
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error('Valid start date is required');
  const end = addMonths(start, 12);
  end.setUTCDate(end.getUTCDate() - 1);

  const fiscalYearInsert = {
    organisation_id: context.organisationId,
    plan_id: input.planId,
    fiscal_year_label: input.label.trim(),
    start_date: iso(start),
    end_date: iso(end),
    status: 'draft',
    created_by: context.userId
  };
  if (!fiscalYearInsert.fiscal_year_label) throw new Error('Fiscal year label is required');

  const { data: fiscalYear, error: fiscalYearError } = await supabase
    .from('fiscal_years')
    .insert(fiscalYearInsert)
    .select('id')
    .single();
  if (fiscalYearError) throw fiscalYearError;

  const periodDrafts = generateMonthlyPlanningPeriods({
    organisationId: context.organisationId,
    fiscalYearStartDate: input.startDate
  }).map((period) => ({ ...period, fiscal_year_id: fiscalYear.id as string }));

  const { error: periodsError } = await supabase.from('planning_periods').insert(periodDrafts);
  if (periodsError) throw periodsError;

  await insertAuditEvent({
    organisationId: context.organisationId,
    actorUserId: context.userId,
    eventType: 'fiscal_year.created',
    entityType: 'fiscal_year',
    entityId: fiscalYear.id as string,
    planId: input.planId,
    fiscalYearId: fiscalYear.id as string,
    newValue: { fiscalYear: fiscalYearInsert, periodCount: periodDrafts.length },
    reason: 'Fiscal year created and monthly planning periods generated'
  });

  return fiscalYear;
}
