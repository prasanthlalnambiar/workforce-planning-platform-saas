// Phase 5 Driver Layer — deterministic engine.
// All driver phasing, reconciliation, aggregation and impact-preview numbers are
// produced here, server-side, with no AI involvement. AI is advisory only and is
// not part of this module or this phase.

export type DriverCategory = 'growth' | 'efficiency' | 'cost_change' | 'supply_change' | 'management_adjustment';
export type DriverImpactType = 'fte_delta' | 'cost_delta' | 'workload_hours_delta';
export type DriverPhasingModel = 'straight_line' | 'ramp_up' | 'ramp_down' | 'one_off';
export type DriverStatus = 'draft' | 'proposed' | 'approved' | 'superseded' | 'voided';
export type DriverConfidence = 'low' | 'medium' | 'high';

export const driverCategories: DriverCategory[] = ['growth', 'efficiency', 'cost_change', 'supply_change', 'management_adjustment'];
export const driverImpactTypes: DriverImpactType[] = ['fte_delta', 'cost_delta', 'workload_hours_delta'];
export const driverPhasingModels: DriverPhasingModel[] = ['straight_line', 'ramp_up', 'ramp_down', 'one_off'];
export const driverConfidenceRatings: DriverConfidence[] = ['low', 'medium', 'high'];

export interface DriverPlanningPeriod {
  id: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

export interface DriverPhasingInput {
  periods: DriverPlanningPeriod[];
  annualImpactAmount: number;
  phasingModel: DriverPhasingModel;
  startPeriodNumber: number;
  endPeriodNumber: number;
  oneOffPeriodNumber?: number | null;
}

export interface DriverLineDraft {
  periodId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  impactAmount: number;
}

export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function isCategory(value: string): value is DriverCategory {
  return (driverCategories as string[]).includes(value);
}

function isImpactType(value: string): value is DriverImpactType {
  return (driverImpactTypes as string[]).includes(value);
}

function isPhasingModel(value: string): value is DriverPhasingModel {
  return (driverPhasingModels as string[]).includes(value);
}

function isConfidence(value: string): value is DriverConfidence {
  return (driverConfidenceRatings as string[]).includes(value);
}

export interface DriverFieldInput {
  driverName: string;
  category: string;
  impactType: string;
  annualImpactAmount: number;
  phasingModel: string;
  confidenceRating: string;
}

export function assertValidDriverInput(input: DriverFieldInput): void {
  if (!input.driverName.trim()) throw new Error('Driver name is required');
  if (!isCategory(input.category)) throw new Error(`Unknown driver category: ${input.category}`);
  if (!isImpactType(input.impactType)) throw new Error(`Unknown driver impact type: ${input.impactType}`);
  if (!isPhasingModel(input.phasingModel)) throw new Error(`Unknown driver phasing model: ${input.phasingModel}`);
  if (!isConfidence(input.confidenceRating)) throw new Error(`Unknown driver confidence rating: ${input.confidenceRating}`);
  if (!Number.isFinite(input.annualImpactAmount)) throw new Error('Annual impact amount must be a finite number');
  if (round2(input.annualImpactAmount) === 0) throw new Error('Annual impact amount must be non-zero');
}

/**
 * Build the phased monthly impact lines for a driver across the full period set.
 * Periods outside the active window receive an explicit zero so a driver always
 * has one line per planning period and lines always sum to the annual amount.
 * Residual rounding is absorbed into the final active period, matching the
 * Phase 4 baseline phasing convention.
 */
export function buildDriverPhasingLines(input: DriverPhasingInput): DriverLineDraft[] {
  const periods = [...input.periods].sort((a, b) => a.periodNumber - b.periodNumber);
  if (periods.length === 0) throw new Error('Planning periods are required to phase a driver');
  if (!Number.isFinite(input.annualImpactAmount) || round2(input.annualImpactAmount) === 0) {
    throw new Error('Annual impact amount must be a non-zero finite number');
  }

  const minPeriod = periods[0].periodNumber;
  const maxPeriod = periods[periods.length - 1].periodNumber;
  const start = input.startPeriodNumber;
  const end = input.endPeriodNumber;

  if (start > end) throw new Error('Driver start period must not be after the end period');
  if (start < minPeriod || end > maxPeriod) throw new Error('Driver phasing window must sit within the fiscal year periods');

  const annual = round2(input.annualImpactAmount);
  const windowPeriods = periods.filter((period) => period.periodNumber >= start && period.periodNumber <= end);

  let windowAmounts: number[];
  if (input.phasingModel === 'one_off') {
    const target = input.oneOffPeriodNumber ?? null;
    if (target === null) throw new Error('One-off drivers require a one-off period');
    if (target < start || target > end) throw new Error('One-off period must sit within the driver phasing window');
    windowAmounts = windowPeriods.map((period) => (period.periodNumber === target ? annual : 0));
  } else if (input.phasingModel === 'straight_line') {
    windowAmounts = distributeByWeights(annual, windowPeriods.map(() => 1));
  } else if (input.phasingModel === 'ramp_up') {
    windowAmounts = distributeByWeights(annual, windowPeriods.map((_, index) => index + 1));
  } else if (input.phasingModel === 'ramp_down') {
    windowAmounts = distributeByWeights(annual, windowPeriods.map((_, index) => windowPeriods.length - index));
  } else {
    throw new Error(`Unknown driver phasing model: ${String(input.phasingModel)}`);
  }

  const amountByPeriodNumber = new Map<number, number>();
  windowPeriods.forEach((period, index) => amountByPeriodNumber.set(period.periodNumber, windowAmounts[index] ?? 0));

  return periods.map((period) => ({
    periodId: period.id,
    periodNumber: period.periodNumber,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    impactAmount: amountByPeriodNumber.get(period.periodNumber) ?? 0
  }));
}

/** Deterministically split a signed amount by integer weights with the rounding residual on the final share. */
export function distributeByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) throw new Error('Phasing weights must sum to a positive value');
  const roundedTotal = round2(total);
  const values = weights.map((weight) => round2((roundedTotal * weight) / weightSum));
  const allocated = values.reduce((sum, value) => round2(sum + value), 0);
  const residual = round2(roundedTotal - allocated);
  values[values.length - 1] = round2(values[values.length - 1] + residual);
  return values;
}

export interface DriverReconciliationResult {
  reconciles: boolean;
  difference: number;
}

export function reconcileDriverLines(annualImpactAmount: number, lines: Pick<DriverLineDraft, 'impactAmount'>[]): DriverReconciliationResult {
  const total = lines.reduce((sum, line) => round2(sum + line.impactAmount), 0);
  const difference = round2(round2(annualImpactAmount) - total);
  return { reconciles: Math.abs(difference) <= 0.01, difference };
}

// ---------------------------------------------------------------------------
// Aggregation and indicative impact preview
// ---------------------------------------------------------------------------

export interface DriverWithLines {
  id: string;
  impactType: DriverImpactType;
  status: DriverStatus;
  lines: { periodId: string; impactAmount: number }[];
}

export interface PeriodImpactTotals {
  fteDelta: number;
  costDelta: number;
  workloadHoursDelta: number;
}

export function aggregateDriverImpactsByPeriod(drivers: DriverWithLines[]): Map<string, PeriodImpactTotals> {
  const totals = new Map<string, PeriodImpactTotals>();
  for (const driver of drivers) {
    for (const line of driver.lines) {
      const entry = totals.get(line.periodId) ?? { fteDelta: 0, costDelta: 0, workloadHoursDelta: 0 };
      if (driver.impactType === 'fte_delta') entry.fteDelta = round2(entry.fteDelta + line.impactAmount);
      if (driver.impactType === 'cost_delta') entry.costDelta = round2(entry.costDelta + line.impactAmount);
      if (driver.impactType === 'workload_hours_delta') entry.workloadHoursDelta = round2(entry.workloadHoursDelta + line.impactAmount);
      totals.set(line.periodId, entry);
    }
  }
  return totals;
}

export interface BaselinePeriodLine {
  periodId: string;
  periodStart: string;
  budgetAmount: number;
  labourCost: number;
  requiredFte: number;
  workloadHours: number;
}

export interface ImpactPreviewRow {
  periodId: string;
  periodStart: string;
  baselineBudget: number;
  baselineLabourCost: number;
  baselineRequiredFte: number;
  baselineWorkloadHours: number;
  approvedBudget: number;
  approvedLabourCost: number;
  approvedRequiredFte: number;
  approvedWorkloadHours: number;
  scenarioBudget: number;
  scenarioLabourCost: number;
  scenarioRequiredFte: number;
  scenarioWorkloadHours: number;
}

export interface ImpactPreview {
  rows: ImpactPreviewRow[];
  totals: {
    baselineBudget: number;
    approvedBudget: number;
    scenarioBudget: number;
    approvedBudgetDelta: number;
    scenarioBudgetDelta: number;
    approvedFteDelta: number;
    scenarioFteDelta: number;
    approvedWorkloadDelta: number;
    scenarioWorkloadDelta: number;
  };
}

/**
 * Build the indicative impact view of the locked baseline plus drivers.
 * cost_delta drivers move labour cost and budget. fte_delta drivers move required FTE.
 * workload_hours_delta drivers move workload hours. This is an indicative,
 * read-only preview: Phase 5 never creates or locks a forecast object — the
 * official reforecast is Phase 6.
 */
export function buildImpactPreview(input: {
  baselineLines: BaselinePeriodLine[];
  approvedDrivers: DriverWithLines[];
  proposedDrivers: DriverWithLines[];
}): ImpactPreview {
  const approvedTotals = aggregateDriverImpactsByPeriod(input.approvedDrivers);
  const scenarioTotals = aggregateDriverImpactsByPeriod([...input.approvedDrivers, ...input.proposedDrivers]);

  const rows: ImpactPreviewRow[] = [...input.baselineLines]
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((line) => {
      const approved = approvedTotals.get(line.periodId) ?? { fteDelta: 0, costDelta: 0, workloadHoursDelta: 0 };
      const scenario = scenarioTotals.get(line.periodId) ?? { fteDelta: 0, costDelta: 0, workloadHoursDelta: 0 };
      return {
        periodId: line.periodId,
        periodStart: line.periodStart,
        baselineBudget: round2(line.budgetAmount),
        baselineLabourCost: round2(line.labourCost),
        baselineRequiredFte: round2(line.requiredFte),
        baselineWorkloadHours: round2(line.workloadHours),
        approvedBudget: round2(line.budgetAmount + approved.costDelta),
        approvedLabourCost: round2(line.labourCost + approved.costDelta),
        approvedRequiredFte: round2(line.requiredFte + approved.fteDelta),
        approvedWorkloadHours: round2(line.workloadHours + approved.workloadHoursDelta),
        scenarioBudget: round2(line.budgetAmount + scenario.costDelta),
        scenarioLabourCost: round2(line.labourCost + scenario.costDelta),
        scenarioRequiredFte: round2(line.requiredFte + scenario.fteDelta),
        scenarioWorkloadHours: round2(line.workloadHours + scenario.workloadHoursDelta)
      };
    });

  const sum = (select: (row: ImpactPreviewRow) => number) => rows.reduce((total, row) => round2(total + select(row)), 0);
  const baselineBudget = sum((row) => row.baselineBudget);
  const approvedBudget = sum((row) => row.approvedBudget);
  const scenarioBudget = sum((row) => row.scenarioBudget);

  return {
    rows,
    totals: {
      baselineBudget,
      approvedBudget,
      scenarioBudget,
      approvedBudgetDelta: round2(approvedBudget - baselineBudget),
      scenarioBudgetDelta: round2(scenarioBudget - baselineBudget),
      approvedFteDelta: round2(sum((row) => row.approvedRequiredFte) - sum((row) => row.baselineRequiredFte)),
      scenarioFteDelta: round2(sum((row) => row.scenarioRequiredFte) - sum((row) => row.baselineRequiredFte)),
      approvedWorkloadDelta: round2(sum((row) => row.approvedWorkloadHours) - sum((row) => row.baselineWorkloadHours)),
      scenarioWorkloadDelta: round2(sum((row) => row.scenarioWorkloadHours) - sum((row) => row.baselineWorkloadHours))
    }
  };
}

// ---------------------------------------------------------------------------
// Status governance matrix (mirrors the database RPC rules)
// ---------------------------------------------------------------------------

const allowedTransitions: Record<DriverStatus, DriverStatus[]> = {
  draft: ['proposed', 'voided'],
  proposed: ['draft', 'approved', 'voided'],
  approved: ['superseded'],
  superseded: [],
  voided: []
};

export function canTransitionDriverStatus(from: DriverStatus, to: DriverStatus): boolean {
  return (allowedTransitions[from] ?? []).includes(to);
}

export function isDriverEditable(status: DriverStatus): boolean {
  return status === 'draft' || status === 'proposed';
}

/** Only approved drivers feed the official forecast position. Proposed drivers feed scenarios only. */
export function feedsOfficialForecast(status: DriverStatus): boolean {
  return status === 'approved';
}

export function feedsScenariosOnly(status: DriverStatus): boolean {
  return status === 'proposed';
}
