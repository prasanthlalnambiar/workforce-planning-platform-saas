import type { PlanningPeriodDraft } from '../../types/models';

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function generateMonthlyPlanningPeriods(params: {
  organisationId: string;
  fiscalYearStartDate: string;
  locale?: string;
}): PlanningPeriodDraft[] {
  const start = new Date(`${params.fiscalYearStartDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Valid fiscal year start date is required');
  }

  return Array.from({ length: 12 }, (_, index) => {
    const periodStart = addMonths(start, index);
    const periodEnd = addMonths(start, index + 1);
    periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);

    return {
      organisation_id: params.organisationId,
      period_number: index + 1,
      period_start: toIsoDate(periodStart),
      period_end: toIsoDate(periodEnd),
      period_label: periodStart.toLocaleString(params.locale ?? 'en-AU', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }),
      status: index === 0 ? 'current_open' : 'future_unlocked',
      editable: true
    };
  });
}
