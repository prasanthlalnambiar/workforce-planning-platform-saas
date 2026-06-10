export const driverCategories = [
  'volume_growth',
  'service_level_change',
  'efficiency',
  'workforce_mix',
  'cost_rate',
  'operating_model',
  'management_adjustment'
] as const;

export const driverDirections = ['increase', 'decrease'] as const;
export const driverImpactBases = ['budget_amount', 'labour_cost', 'required_fte', 'workload_hours', 'multi_metric'] as const;
export const driverRiskRatings = ['low', 'medium', 'high'] as const;

export type DriverCategory = (typeof driverCategories)[number];
export type DriverDirection = (typeof driverDirections)[number];
export type DriverImpactBasis = (typeof driverImpactBases)[number];
export type DriverRiskRating = (typeof driverRiskRatings)[number];

export interface DriverPlanningPeriod {
  periodId: string;
  budgetBaselineLineId: string;
  periodStart: string;
  periodEnd: string;
}

export interface DriverImpactInput {
  annualBudgetDelta: number;
  annualLabourCostDelta: number;
  annualRequiredFteDelta: number;
  annualWorkloadHoursDelta: number;
  phasingMethod?: 'straight_line' | 'custom_manual';
  notes?: string | null;
}

export interface DriverMonthlyImpact {
  periodId: string;
  budgetBaselineLineId: string;
  periodStart: string;
  periodEnd: string;
  budgetDelta: number;
  labourCostDelta: number;
  requiredFteDelta: number;
  workloadHoursDelta: number;
  phasingMethod: 'straight_line' | 'custom_manual';
  notes: string | null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function splitEvenly(total: number, count: number, digits: number): number[] {
  if (count <= 0) return [];
  const base = round(total / count, digits);
  const values = Array.from({ length: count }, () => base);
  values[count - 1] = round(total - values.slice(0, -1).reduce((sum, value) => sum + value, 0), digits);
  return values;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function phaseDriverImpact(periods: DriverPlanningPeriod[], input: DriverImpactInput): DriverMonthlyImpact[] {
  const count = periods.length;
  const budgetValues = splitEvenly(finiteNumber(input.annualBudgetDelta), count, 2);
  const labourValues = splitEvenly(finiteNumber(input.annualLabourCostDelta), count, 2);
  const fteValues = splitEvenly(finiteNumber(input.annualRequiredFteDelta), count, 2);
  const workloadValues = splitEvenly(finiteNumber(input.annualWorkloadHoursDelta), count, 2);

  return periods.map((period, index) => ({
    periodId: period.periodId,
    budgetBaselineLineId: period.budgetBaselineLineId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    budgetDelta: budgetValues[index] ?? 0,
    labourCostDelta: labourValues[index] ?? 0,
    requiredFteDelta: fteValues[index] ?? 0,
    workloadHoursDelta: workloadValues[index] ?? 0,
    phasingMethod: input.phasingMethod ?? 'straight_line',
    notes: input.notes ?? null
  }));
}

export function summariseDriverImpacts(impacts: DriverMonthlyImpact[]) {
  return {
    totalBudgetDelta: round(impacts.reduce((sum, impact) => sum + impact.budgetDelta, 0), 2),
    totalLabourCostDelta: round(impacts.reduce((sum, impact) => sum + impact.labourCostDelta, 0), 2),
    totalRequiredFteDelta: round(impacts.reduce((sum, impact) => sum + impact.requiredFteDelta, 0), 2),
    totalWorkloadHoursDelta: round(impacts.reduce((sum, impact) => sum + impact.workloadHoursDelta, 0), 2)
  };
}

export function signedDriverValue(value: number, direction: DriverDirection): number {
  const magnitude = Math.abs(finiteNumber(value));
  return direction === 'decrease' ? -magnitude : magnitude;
}

export function isDriverCategory(value: string): value is DriverCategory {
  return driverCategories.includes(value as DriverCategory);
}

export function isDriverDirection(value: string): value is DriverDirection {
  return driverDirections.includes(value as DriverDirection);
}

export function isDriverImpactBasis(value: string): value is DriverImpactBasis {
  return driverImpactBases.includes(value as DriverImpactBasis);
}

export function isDriverRiskRating(value: string): value is DriverRiskRating {
  return driverRiskRatings.includes(value as DriverRiskRating);
}
