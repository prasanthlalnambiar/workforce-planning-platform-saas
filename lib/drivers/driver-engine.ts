export const driverCategories = [
  'growth',
  'efficiency',
  'cost_change',
  'supply_change',
  'management_adjustment'
] as const;

export const driverDirections = ['increase', 'decrease'] as const;
export const driverImpactBases = ['budget_amount', 'labour_cost', 'required_fte', 'workload_hours', 'multi_metric'] as const;
export const driverPhasingMethods = ['straight_line', 'ramp_up', 'ramp_down', 'one_off'] as const;
export const driverRiskRatings = ['low', 'medium', 'high'] as const;
export const driverStatuses = ['draft', 'proposed', 'approved', 'superseded', 'voided'] as const;
export const driverImpactTreatments = ['draft_preview', 'scenario_preview', 'official_impact', 'excluded'] as const;

export type DriverCategory = (typeof driverCategories)[number];
export type DriverDirection = (typeof driverDirections)[number];
export type DriverImpactBasis = (typeof driverImpactBases)[number];
export type DriverPhasingMethod = (typeof driverPhasingMethods)[number];
export type DriverRiskRating = (typeof driverRiskRatings)[number];
export type DriverStatus = (typeof driverStatuses)[number];
export type DriverImpactTreatment = (typeof driverImpactTreatments)[number];

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
  phasingMethod?: DriverPhasingMethod;
  oneOffPeriodIndex?: number;
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
  phasingMethod: DriverPhasingMethod;
  notes: string | null;
}

export interface DriverPortfolioItem {
  status: DriverStatus;
  impacts: DriverMonthlyImpact[];
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

function splitByWeights(total: number, weights: number[], digits: number): number[] {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) return weights.map(() => 0);
  const values = weights.map((weight) => round((total * weight) / weightTotal, digits));
  values[values.length - 1] = round(total - values.slice(0, -1).reduce((sum, value) => sum + value, 0), digits);
  return values;
}

function splitOneOff(total: number, count: number, periodIndex: number, digits: number): number[] {
  const values = Array.from({ length: count }, () => 0);
  if (count <= 0) return values;
  const safeIndex = Math.min(Math.max(Math.trunc(periodIndex), 0), count - 1);
  values[safeIndex] = round(total, digits);
  return values;
}

function splitPhased(total: number, count: number, method: DriverPhasingMethod, digits: number, oneOffPeriodIndex = 0): number[] {
  if (method === 'straight_line') return splitEvenly(total, count, digits);
  if (method === 'ramp_up') return splitByWeights(total, Array.from({ length: count }, (_, index) => index + 1), digits);
  if (method === 'ramp_down') return splitByWeights(total, Array.from({ length: count }, (_, index) => count - index), digits);
  return splitOneOff(total, count, oneOffPeriodIndex, digits);
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function phaseDriverImpact(periods: DriverPlanningPeriod[], input: DriverImpactInput): DriverMonthlyImpact[] {
  const count = periods.length;
  const phasingMethod = input.phasingMethod ?? 'straight_line';
  const budgetValues = splitPhased(finiteNumber(input.annualBudgetDelta), count, phasingMethod, 2, input.oneOffPeriodIndex);
  const labourValues = splitPhased(finiteNumber(input.annualLabourCostDelta), count, phasingMethod, 2, input.oneOffPeriodIndex);
  const fteValues = splitPhased(finiteNumber(input.annualRequiredFteDelta), count, phasingMethod, 2, input.oneOffPeriodIndex);
  const workloadValues = splitPhased(finiteNumber(input.annualWorkloadHoursDelta), count, phasingMethod, 2, input.oneOffPeriodIndex);

  return periods.map((period, index) => ({
    periodId: period.periodId,
    budgetBaselineLineId: period.budgetBaselineLineId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    budgetDelta: budgetValues[index] ?? 0,
    labourCostDelta: labourValues[index] ?? 0,
    requiredFteDelta: fteValues[index] ?? 0,
    workloadHoursDelta: workloadValues[index] ?? 0,
    phasingMethod,
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

export function driverImpactTreatment(status: DriverStatus): DriverImpactTreatment {
  if (status === 'approved') return 'official_impact';
  if (status === 'proposed') return 'scenario_preview';
  if (status === 'draft') return 'draft_preview';
  return 'excluded';
}

export function summariseDriverPortfolio(items: DriverPortfolioItem[]) {
  return items.reduce((summary, item) => {
    const impactSummary = summariseDriverImpacts(item.impacts);
    if (driverImpactTreatment(item.status) === 'official_impact') {
      summary.officialBudgetDelta = round(summary.officialBudgetDelta + impactSummary.totalBudgetDelta, 2);
      summary.officialLabourCostDelta = round(summary.officialLabourCostDelta + impactSummary.totalLabourCostDelta, 2);
      summary.officialRequiredFteDelta = round(summary.officialRequiredFteDelta + impactSummary.totalRequiredFteDelta, 2);
      summary.officialWorkloadHoursDelta = round(summary.officialWorkloadHoursDelta + impactSummary.totalWorkloadHoursDelta, 2);
    }
    if (driverImpactTreatment(item.status) === 'scenario_preview') {
      summary.proposedBudgetDelta = round(summary.proposedBudgetDelta + impactSummary.totalBudgetDelta, 2);
      summary.proposedLabourCostDelta = round(summary.proposedLabourCostDelta + impactSummary.totalLabourCostDelta, 2);
      summary.proposedRequiredFteDelta = round(summary.proposedRequiredFteDelta + impactSummary.totalRequiredFteDelta, 2);
      summary.proposedWorkloadHoursDelta = round(summary.proposedWorkloadHoursDelta + impactSummary.totalWorkloadHoursDelta, 2);
    }
    return summary;
  }, {
    officialBudgetDelta: 0,
    officialLabourCostDelta: 0,
    officialRequiredFteDelta: 0,
    officialWorkloadHoursDelta: 0,
    proposedBudgetDelta: 0,
    proposedLabourCostDelta: 0,
    proposedRequiredFteDelta: 0,
    proposedWorkloadHoursDelta: 0
  });
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

export function isDriverPhasingMethod(value: string): value is DriverPhasingMethod {
  return driverPhasingMethods.includes(value as DriverPhasingMethod);
}

export function isDriverRiskRating(value: string): value is DriverRiskRating {
  return driverRiskRatings.includes(value as DriverRiskRating);
}

export function isDriverStatus(value: string): value is DriverStatus {
  return driverStatuses.includes(value as DriverStatus);
}
