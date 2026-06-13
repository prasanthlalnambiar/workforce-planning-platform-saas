// Phase 6 Reforecast Module — deterministic engine.
//
// Working forecast = locked budget baseline + approved drivers, period by period.
// Only approved drivers feed the official forecast. Proposed drivers may be shown
// in a scenario overlay but never feed the official numbers. All calculation
// happens here, server-side; no AI generates official numbers and no calculation
// logic lives in React components.

import { createHash } from 'node:crypto';
import { round2, type DriverCategory, type DriverImpactType, type DriverStatus } from '../drivers/driver-engine';

export type ReforecastStatus = 'draft' | 'in_review' | 'locked' | 'superseded' | 'voided';

export const reforecastDriverCategories: DriverCategory[] = ['growth', 'efficiency', 'cost_change', 'supply_change', 'management_adjustment'];

export interface ReforecastBaselineLine {
  periodId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  budgetAmount: number;
  labourCost: number;
  requiredFte: number;
  workloadHours: number;
}

export interface ReforecastDriverInput {
  id: string;
  driverCode: string;
  driverName: string;
  category: DriverCategory;
  impactType: DriverImpactType;
  status: DriverStatus;
  annualImpactAmount: number;
  lines: { periodId: string; impactAmount: number }[];
}

export interface ReforecastLineDraft {
  periodId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  baselineBudgetAmount: number;
  baselineLabourCost: number;
  baselineRequiredFte: number;
  baselineWorkloadHours: number;
  growthCostImpact: number;
  efficiencyCostImpact: number;
  costChangeCostImpact: number;
  supplyChangeCostImpact: number;
  managementAdjustmentCostImpact: number;
  totalCostImpact: number;
  totalFteImpact: number;
  totalWorkloadHoursImpact: number;
  forecastBudgetAmount: number;
  forecastLabourCost: number;
  forecastRequiredFte: number;
  forecastWorkloadHours: number;
}

export interface ReforecastDriverImpactDraft {
  forecastDriverId: string;
  driverCode: string;
  driverName: string;
  category: DriverCategory;
  impactType: DriverImpactType;
  annualImpactAmount: number;
  driverStatusAtCalculation: 'approved';
}

const categoryCostKey: Record<DriverCategory, keyof Pick<ReforecastLineDraft, 'growthCostImpact' | 'efficiencyCostImpact' | 'costChangeCostImpact' | 'supplyChangeCostImpact' | 'managementAdjustmentCostImpact'>> = {
  growth: 'growthCostImpact',
  efficiency: 'efficiencyCostImpact',
  cost_change: 'costChangeCostImpact',
  supply_change: 'supplyChangeCostImpact',
  management_adjustment: 'managementAdjustmentCostImpact'
};

/**
 * Build the official working-forecast lines from the locked baseline plus the
 * approved drivers ONLY. Any driver whose status is not 'approved' is rejected
 * here so a proposed or draft driver can never leak into the official forecast,
 * regardless of what the caller passes.
 *
 * Cost-type driver impacts are broken down by driver category and move both the
 * forecast budget and the forecast labour cost. FTE and workload-hours impacts
 * move their own forecast measures. forecast = baseline + total approved impact,
 * per period, with two-decimal determinism.
 */
export function buildReforecastLines(input: {
  baselineLines: ReforecastBaselineLine[];
  approvedDrivers: ReforecastDriverInput[];
}): ReforecastLineDraft[] {
  if (input.baselineLines.length === 0) {
    throw new Error('A locked baseline with phased lines is required to build a reforecast');
  }
  for (const driver of input.approvedDrivers) {
    if (driver.status !== 'approved') {
      throw new Error(`Only approved drivers can feed the official forecast. Driver ${driver.driverCode} is ${driver.status}.`);
    }
  }

  const sorted = [...input.baselineLines].sort((a, b) => a.periodNumber - b.periodNumber);

  return sorted.map((line) => {
    const draft: ReforecastLineDraft = {
      periodId: line.periodId,
      periodNumber: line.periodNumber,
      periodStart: line.periodStart,
      periodEnd: line.periodEnd,
      baselineBudgetAmount: round2(line.budgetAmount),
      baselineLabourCost: round2(line.labourCost),
      baselineRequiredFte: round2(line.requiredFte),
      baselineWorkloadHours: round2(line.workloadHours),
      growthCostImpact: 0,
      efficiencyCostImpact: 0,
      costChangeCostImpact: 0,
      supplyChangeCostImpact: 0,
      managementAdjustmentCostImpact: 0,
      totalCostImpact: 0,
      totalFteImpact: 0,
      totalWorkloadHoursImpact: 0,
      forecastBudgetAmount: 0,
      forecastLabourCost: 0,
      forecastRequiredFte: 0,
      forecastWorkloadHours: 0
    };

    for (const driver of input.approvedDrivers) {
      const driverLine = driver.lines.find((candidate) => candidate.periodId === line.periodId);
      if (!driverLine || driverLine.impactAmount === 0) continue;
      const amount = round2(driverLine.impactAmount);
      if (driver.impactType === 'cost_delta') {
        const key = categoryCostKey[driver.category];
        draft[key] = round2(draft[key] + amount);
        draft.totalCostImpact = round2(draft.totalCostImpact + amount);
      } else if (driver.impactType === 'fte_delta') {
        draft.totalFteImpact = round2(draft.totalFteImpact + amount);
      } else if (driver.impactType === 'workload_hours_delta') {
        draft.totalWorkloadHoursImpact = round2(draft.totalWorkloadHoursImpact + amount);
      }
    }

    draft.forecastBudgetAmount = round2(draft.baselineBudgetAmount + draft.totalCostImpact);
    draft.forecastLabourCost = round2(draft.baselineLabourCost + draft.totalCostImpact);
    draft.forecastRequiredFte = round2(draft.baselineRequiredFte + draft.totalFteImpact);
    draft.forecastWorkloadHours = round2(draft.baselineWorkloadHours + draft.totalWorkloadHoursImpact);
    return draft;
  });
}

/** Every official forecast line must equal baseline plus total approved impact. */
export function reconcileReforecastLines(lines: ReforecastLineDraft[]): { reconciles: boolean; firstDrift: number } {
  for (const line of lines) {
    const drift = round2(line.forecastBudgetAmount - line.baselineBudgetAmount - line.totalCostImpact);
    if (Math.abs(drift) > 0.01) return { reconciles: false, firstDrift: drift };
    const categorySum = round2(
      line.growthCostImpact + line.efficiencyCostImpact + line.costChangeCostImpact + line.supplyChangeCostImpact + line.managementAdjustmentCostImpact
    );
    const categoryDrift = round2(categorySum - line.totalCostImpact);
    if (Math.abs(categoryDrift) > 0.01) return { reconciles: false, firstDrift: categoryDrift };
  }
  return { reconciles: true, firstDrift: 0 };
}

/** Snapshot of exactly which approved drivers fed the calculation. */
export function buildDriverInclusionSnapshot(approvedDrivers: ReforecastDriverInput[]): ReforecastDriverImpactDraft[] {
  return approvedDrivers.map((driver) => {
    if (driver.status !== 'approved') {
      throw new Error(`Only approved drivers can appear in the official inclusion snapshot. Driver ${driver.driverCode} is ${driver.status}.`);
    }
    return {
      forecastDriverId: driver.id,
      driverCode: driver.driverCode,
      driverName: driver.driverName,
      category: driver.category,
      impactType: driver.impactType,
      annualImpactAmount: round2(driver.annualImpactAmount),
      driverStatusAtCalculation: 'approved'
    };
  });
}

export interface ScenarioOverlayRow {
  periodId: string;
  periodStart: string;
  officialForecastBudget: number;
  scenarioCostImpact: number;
  scenarioForecastBudget: number;
  officialForecastFte: number;
  scenarioFteImpact: number;
  scenarioForecastFte: number;
}

/**
 * Scenario-only overlay: official forecast plus PROPOSED drivers. This view is
 * never persisted as forecast data and never feeds the official numbers —
 * proposed drivers are scenario-only by design.
 */
export function buildScenarioOverlay(input: {
  officialLines: ReforecastLineDraft[];
  proposedDrivers: ReforecastDriverInput[];
}): ScenarioOverlayRow[] {
  for (const driver of input.proposedDrivers) {
    if (driver.status !== 'proposed') {
      throw new Error(`Scenario overlay accepts proposed drivers only. Driver ${driver.driverCode} is ${driver.status}.`);
    }
  }
  return input.officialLines.map((line) => {
    let scenarioCost = 0;
    let scenarioFte = 0;
    for (const driver of input.proposedDrivers) {
      const driverLine = driver.lines.find((candidate) => candidate.periodId === line.periodId);
      if (!driverLine) continue;
      if (driver.impactType === 'cost_delta') scenarioCost = round2(scenarioCost + driverLine.impactAmount);
      if (driver.impactType === 'fte_delta') scenarioFte = round2(scenarioFte + driverLine.impactAmount);
    }
    return {
      periodId: line.periodId,
      periodStart: line.periodStart,
      officialForecastBudget: line.forecastBudgetAmount,
      scenarioCostImpact: scenarioCost,
      scenarioForecastBudget: round2(line.forecastBudgetAmount + scenarioCost),
      officialForecastFte: line.forecastRequiredFte,
      scenarioFteImpact: scenarioFte,
      scenarioForecastFte: round2(line.forecastRequiredFte + scenarioFte)
    };
  });
}

/**
 * Deterministic checksum of the full forecast state. Stable across recalculation
 * with identical inputs; changes whenever any line value or included driver
 * changes. Stored on lock and in the lock snapshot as tamper evidence.
 */
export function computeReforecastChecksum(lines: ReforecastLineDraft[], impacts: ReforecastDriverImpactDraft[]): string {
  const canonicalLines = [...lines]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((line) => [
      line.periodId, line.periodNumber,
      line.baselineBudgetAmount.toFixed(2), line.baselineLabourCost.toFixed(2), line.baselineRequiredFte.toFixed(2), line.baselineWorkloadHours.toFixed(2),
      line.growthCostImpact.toFixed(2), line.efficiencyCostImpact.toFixed(2), line.costChangeCostImpact.toFixed(2),
      line.supplyChangeCostImpact.toFixed(2), line.managementAdjustmentCostImpact.toFixed(2),
      line.totalCostImpact.toFixed(2), line.totalFteImpact.toFixed(2), line.totalWorkloadHoursImpact.toFixed(2),
      line.forecastBudgetAmount.toFixed(2), line.forecastLabourCost.toFixed(2), line.forecastRequiredFte.toFixed(2), line.forecastWorkloadHours.toFixed(2)
    ].join('|'))
    .join('\n');
  const canonicalImpacts = [...impacts]
    .sort((a, b) => a.driverCode.localeCompare(b.driverCode))
    .map((impact) => [impact.forecastDriverId, impact.driverCode, impact.category, impact.impactType, impact.annualImpactAmount.toFixed(2)].join('|'))
    .join('\n');
  return createHash('sha256').update(`${canonicalLines}\n--impacts--\n${canonicalImpacts}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Lifecycle governance matrix (mirrors the database RPC rules)
// ---------------------------------------------------------------------------

const allowedTransitions: Record<ReforecastStatus, ReforecastStatus[]> = {
  draft: ['in_review', 'voided'],
  in_review: ['draft', 'locked', 'voided'],
  locked: ['superseded', 'voided'],
  superseded: [],
  voided: []
};

export function canTransitionReforecastStatus(from: ReforecastStatus, to: ReforecastStatus): boolean {
  return (allowedTransitions[from] ?? []).includes(to);
}

export function isReforecastRecalculable(status: ReforecastStatus): boolean {
  return status === 'draft';
}

export function isReforecastImmutable(status: ReforecastStatus): boolean {
  return status === 'locked' || status === 'superseded' || status === 'voided';
}

export interface ReforecastTotals {
  baselineBudget: number;
  totalCostImpact: number;
  forecastBudget: number;
  baselineFte: number;
  totalFteImpact: number;
  forecastFte: number;
  categoryCostImpacts: Record<DriverCategory, number>;
}

export function summariseReforecast(lines: ReforecastLineDraft[]): ReforecastTotals {
  const sum = (select: (line: ReforecastLineDraft) => number) => lines.reduce((total, line) => round2(total + select(line)), 0);
  return {
    baselineBudget: sum((line) => line.baselineBudgetAmount),
    totalCostImpact: sum((line) => line.totalCostImpact),
    forecastBudget: sum((line) => line.forecastBudgetAmount),
    baselineFte: sum((line) => line.baselineRequiredFte),
    totalFteImpact: sum((line) => line.totalFteImpact),
    forecastFte: sum((line) => line.forecastRequiredFte),
    categoryCostImpacts: {
      growth: sum((line) => line.growthCostImpact),
      efficiency: sum((line) => line.efficiencyCostImpact),
      cost_change: sum((line) => line.costChangeCostImpact),
      supply_change: sum((line) => line.supplyChangeCostImpact),
      management_adjustment: sum((line) => line.managementAdjustmentCostImpact)
    }
  };
}
