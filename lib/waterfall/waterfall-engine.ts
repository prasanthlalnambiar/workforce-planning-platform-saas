// Phase 8 Waterfall Bridge — pure, deterministic, read-only engine.
//
// Explains the movement Baseline -> Approved Drivers (by category) -> Locked
// Forecast -> Actuals as a reconciling bridge. Every input is an immutable,
// locked record: the bridge is anchored to a LOCKED variance report, which
// transitively pins the locked baseline, the locked forecast version and the
// posted actuals version. The engine reads the pinned reforecast lines (which
// already carry per-category cost impacts) and the pinned variance lines, and
// computes the bridge with no database mutation, no AI, and no free-text
// official output. All arithmetic is two-decimal and lives in lib/, never in a
// React component.

import { round2, type DriverCategory } from '../drivers/driver-engine';

export const DRIVER_CATEGORY_ORDER: DriverCategory[] = [
  'growth', 'efficiency', 'cost_change', 'supply_change', 'management_adjustment'
];

export const DRIVER_CATEGORY_LABELS: Record<DriverCategory, string> = {
  growth: 'Growth driver impact',
  efficiency: 'Efficiency driver impact',
  cost_change: 'Cost-rate driver impact',
  supply_change: 'Supply / change driver impact',
  management_adjustment: 'Management adjustment'
};

/** One pinned reforecast line (category impacts already computed at lock time). */
export interface BridgeReforecastLine {
  planningPeriodId: string;
  periodNumber: number;
  baselineBudgetAmount: number;
  growthCostImpact: number;
  efficiencyCostImpact: number;
  costChangeCostImpact: number;
  supplyChangeCostImpact: number;
  managementAdjustmentCostImpact: number;
  forecastBudgetAmount: number;
}

/** One pinned variance line (actual vs forecast vs baseline, already computed). */
export interface BridgeVarianceLine {
  planningPeriodId: string;
  periodNumber: number;
  periodLabel: string;
  actualCost: number;
  forecastCost: number;
  baselineCost: number;
  costVarianceToForecast: number;
  costVarianceToBaseline: number;
}

export type BridgeStepKind =
  | 'baseline'
  | 'driver'
  | 'forecast'
  | 'variance'
  | 'actual';

export interface BridgeStep {
  key: string;
  label: string;
  kind: BridgeStepKind;
  category: DriverCategory | null;
  /** Signed movement contributed by this step. */
  amount: number;
  /** Running total after applying this step (subtotal rows echo the running total). */
  runningTotal: number;
  /** Subtotal anchors (baseline / forecast / actual) are not movements themselves. */
  isSubtotal: boolean;
}

export interface BridgePeriodBridge {
  planningPeriodId: string;
  periodNumber: number;
  periodLabel: string;
  baselineCost: number;
  categoryImpacts: Record<DriverCategory, number>;
  forecastCost: number;
  varianceToForecast: number;
  actualCost: number;
  varianceToBaseline: number;
  reconciles: boolean;
}

export interface WaterfallBridge {
  steps: BridgeStep[];
  periods: BridgePeriodBridge[];
  totals: {
    baselineCost: number;
    categoryImpacts: Record<DriverCategory, number>;
    driverImpactTotal: number;
    forecastCost: number;
    varianceToForecast: number;
    actualCost: number;
    varianceToBaseline: number;
  };
  reconciliation: {
    baselinePlusDriversEqualsForecast: boolean;
    forecastPlusVarianceEqualsActual: boolean;
    periodsReconcileToTotal: boolean;
    allReconciled: boolean;
    maxResidual: number;
  };
}

const RECONCILE_TOLERANCE = 0.01;

function emptyCategoryMap(): Record<DriverCategory, number> {
  return { growth: 0, efficiency: 0, cost_change: 0, supply_change: 0, management_adjustment: 0 };
}

function categoryImpactsFor(line: BridgeReforecastLine): Record<DriverCategory, number> {
  return {
    growth: round2(line.growthCostImpact),
    efficiency: round2(line.efficiencyCostImpact),
    cost_change: round2(line.costChangeCostImpact),
    supply_change: round2(line.supplyChangeCostImpact),
    management_adjustment: round2(line.managementAdjustmentCostImpact)
  };
}

/**
 * Build the deterministic waterfall bridge for the covered periods of a locked
 * variance report.
 *
 * Reconciliation (per period and in total, to the cent):
 *   baseline + sum(category impacts) = forecast
 *   forecast + variance-to-forecast  = actual
 * The bridge never invents values: category impacts come from the pinned
 * reforecast lines, and actual/forecast/baseline come from the pinned variance
 * lines. Forecast amounts are cross-checked between the two pinned sources.
 */
export function buildWaterfallBridge(input: {
  reforecastLines: BridgeReforecastLine[];
  varianceLines: BridgeVarianceLine[];
}): WaterfallBridge {
  const reforecastByPeriod = new Map(input.reforecastLines.map((line) => [line.planningPeriodId, line]));

  // Covered periods are exactly the variance report's periods, ordered.
  const ordered = [...input.varianceLines].sort((a, b) => a.periodNumber - b.periodNumber);

  const periods: BridgePeriodBridge[] = [];
  const totalsCategory = emptyCategoryMap();
  let totalBaseline = 0;
  let totalForecast = 0;
  let totalActual = 0;
  let totalVarToForecast = 0;
  let totalVarToBaseline = 0;
  let maxResidual = 0;

  for (const varianceLine of ordered) {
    const reforecastLine = reforecastByPeriod.get(varianceLine.planningPeriodId);
    if (!reforecastLine) {
      throw new Error(`Waterfall rejected: covered period ${varianceLine.periodLabel} has no pinned reforecast line`);
    }

    const categoryImpacts = categoryImpactsFor(reforecastLine);
    const baselineCost = round2(varianceLine.baselineCost);
    const forecastCost = round2(varianceLine.forecastCost);
    const actualCost = round2(varianceLine.actualCost);
    const driverSum = round2(Object.values(categoryImpacts).reduce((total, value) => round2(total + value), 0));

    // Forecast amount must agree between the pinned reforecast line and the
    // pinned variance line, and baseline + drivers must equal forecast.
    const forecastResidual = round2(baselineCost + driverSum - forecastCost);
    const crossSourceResidual = round2(reforecastLine.forecastBudgetAmount - forecastCost);
    const varianceResidual = round2(forecastCost + varianceLine.costVarianceToForecast - actualCost);
    const periodReconciles =
      Math.abs(forecastResidual) <= RECONCILE_TOLERANCE &&
      Math.abs(crossSourceResidual) <= RECONCILE_TOLERANCE &&
      Math.abs(varianceResidual) <= RECONCILE_TOLERANCE;

    maxResidual = Math.max(maxResidual, Math.abs(forecastResidual), Math.abs(crossSourceResidual), Math.abs(varianceResidual));

    for (const category of DRIVER_CATEGORY_ORDER) {
      totalsCategory[category] = round2(totalsCategory[category] + categoryImpacts[category]);
    }
    totalBaseline = round2(totalBaseline + baselineCost);
    totalForecast = round2(totalForecast + forecastCost);
    totalActual = round2(totalActual + actualCost);
    totalVarToForecast = round2(totalVarToForecast + varianceLine.costVarianceToForecast);
    totalVarToBaseline = round2(totalVarToBaseline + varianceLine.costVarianceToBaseline);

    periods.push({
      planningPeriodId: varianceLine.planningPeriodId,
      periodNumber: varianceLine.periodNumber,
      periodLabel: varianceLine.periodLabel,
      baselineCost,
      categoryImpacts,
      forecastCost,
      varianceToForecast: round2(varianceLine.costVarianceToForecast),
      actualCost,
      varianceToBaseline: round2(varianceLine.costVarianceToBaseline),
      reconciles: periodReconciles
    });
  }

  const driverImpactTotal = round2(DRIVER_CATEGORY_ORDER.reduce((total, category) => round2(total + totalsCategory[category]), 0));

  // Build the FY-level bridge steps in finance order.
  const steps: BridgeStep[] = [];
  let running = totalBaseline;
  steps.push({ key: 'baseline', label: 'Locked baseline', kind: 'baseline', category: null, amount: totalBaseline, runningTotal: running, isSubtotal: true });
  for (const category of DRIVER_CATEGORY_ORDER) {
    running = round2(running + totalsCategory[category]);
    steps.push({ key: `driver_${category}`, label: DRIVER_CATEGORY_LABELS[category], kind: 'driver', category, amount: totalsCategory[category], runningTotal: running, isSubtotal: false });
  }
  steps.push({ key: 'forecast', label: 'Locked forecast', kind: 'forecast', category: null, amount: totalForecast, runningTotal: totalForecast, isSubtotal: true });
  running = round2(totalForecast + totalVarToForecast);
  steps.push({ key: 'variance', label: 'Variance to actuals', kind: 'variance', category: null, amount: totalVarToForecast, runningTotal: running, isSubtotal: false });
  steps.push({ key: 'actual', label: 'Actual result', kind: 'actual', category: null, amount: totalActual, runningTotal: totalActual, isSubtotal: true });

  // FY reconciliation.
  const baselinePlusDriversEqualsForecast = Math.abs(round2(totalBaseline + driverImpactTotal - totalForecast)) <= RECONCILE_TOLERANCE;
  const forecastPlusVarianceEqualsActual = Math.abs(round2(totalForecast + totalVarToForecast - totalActual)) <= RECONCILE_TOLERANCE;
  const periodsReconcileToTotal =
    Math.abs(round2(periods.reduce((total, period) => round2(total + period.baselineCost), 0) - totalBaseline)) <= RECONCILE_TOLERANCE &&
    Math.abs(round2(periods.reduce((total, period) => round2(total + period.forecastCost), 0) - totalForecast)) <= RECONCILE_TOLERANCE &&
    Math.abs(round2(periods.reduce((total, period) => round2(total + period.actualCost), 0) - totalActual)) <= RECONCILE_TOLERANCE;

  maxResidual = Math.max(
    maxResidual,
    Math.abs(round2(totalBaseline + driverImpactTotal - totalForecast)),
    Math.abs(round2(totalForecast + totalVarToForecast - totalActual))
  );

  return {
    steps,
    periods,
    totals: {
      baselineCost: totalBaseline,
      categoryImpacts: totalsCategory,
      driverImpactTotal,
      forecastCost: totalForecast,
      varianceToForecast: totalVarToForecast,
      actualCost: totalActual,
      varianceToBaseline: totalVarToBaseline
    },
    reconciliation: {
      baselinePlusDriversEqualsForecast,
      forecastPlusVarianceEqualsActual,
      periodsReconcileToTotal,
      allReconciled: baselinePlusDriversEqualsForecast && forecastPlusVarianceEqualsActual && periodsReconcileToTotal,
      maxResidual: round2(maxResidual)
    }
  };
}

// ---------------------------------------------------------------------------
// Controlled-state detection: the waterfall is read-only and must never
// compute from draft / unlocked objects. The page asks the engine which (if
// any) required source is missing so it can render a clear controlled state.
// ---------------------------------------------------------------------------

export type WaterfallReadiness =
  | 'ready'
  | 'no_locked_baseline'
  | 'no_locked_forecast'
  | 'no_posted_actuals'
  | 'no_locked_variance'
  | 'incomplete_inputs'
  | 'inconsistent_pinned_sources';

export const WATERFALL_READINESS_MESSAGE: Record<Exclude<WaterfallReadiness, 'ready'>, string> = {
  no_locked_baseline: 'No locked budget baseline is available. Lock a baseline before building the waterfall.',
  no_locked_forecast: 'No locked forecast is available. Lock a reforecast before building the waterfall.',
  no_posted_actuals: 'No posted actuals batch is available. Post actuals before building the waterfall.',
  no_locked_variance: 'No locked variance report is available. Lock a variance report; the waterfall is anchored to it.',
  incomplete_inputs: 'The locked variance report is missing pinned forecast or variance lines. The waterfall cannot be built from incomplete inputs.',
  inconsistent_pinned_sources: 'The pinned upstream sources are not in valid governed states, or their lock versions/checksums no longer match what the variance report pinned. The waterfall will not calculate from inconsistent sources.'
};

export function assessWaterfallReadiness(input: {
  hasLockedBaseline: boolean;
  hasLockedForecast: boolean;
  hasPostedActuals: boolean;
  hasLockedVariance: boolean;
  hasReforecastLines: boolean;
  hasVarianceLines: boolean;
}): WaterfallReadiness {
  if (!input.hasLockedBaseline) return 'no_locked_baseline';
  if (!input.hasLockedForecast) return 'no_locked_forecast';
  if (!input.hasPostedActuals) return 'no_posted_actuals';
  if (!input.hasLockedVariance) return 'no_locked_variance';
  if (!input.hasReforecastLines || !input.hasVarianceLines) return 'incomplete_inputs';
  return 'ready';
}

/**
 * Validate that the pinned upstream sources are in valid governed states AND
 * still match what the locked variance report pinned. A bridge must never be
 * built from draft/voided sources or from sources whose lock version/checksum
 * has drifted from the variance report's pins.
 *
 * Returns an empty array when every check passes; otherwise the list of
 * human-readable inconsistencies (the page renders a controlled state).
 */
export interface PinnedSourceStatuses {
  baselineStatus: string | null;
  reforecastStatus: string | null;
  actualsStatus: string | null;
  varianceStatus: string | null;
}

export interface PinnedSourceValues {
  // From variance_reports (the pins recorded at lock time)
  comparatorLockVersionId: string | null;
  comparatorChecksum: string | null;
  actualsChecksum: string | null;
  actualsVersionNumber: number | null;
  baselineChecksum: string | null;
  // From the live upstream records (loaded by id)
  reforecastLockVersionId: string | null;
  reforecastChecksum: string | null;
  actualsBatchChecksum: string | null;
  actualsBatchVersionNumber: number | null;
  budgetBaselineChecksum: string | null;
}

export function validatePinnedSources(
  statuses: PinnedSourceStatuses,
  values: PinnedSourceValues
): string[] {
  const issues: string[] = [];

  // 1. Governed status of every upstream source.
  if (statuses.baselineStatus !== 'locked') {
    issues.push(`Pinned baseline is not locked (status: ${statuses.baselineStatus ?? 'missing'}).`);
  }
  if (statuses.reforecastStatus === null || !['locked', 'superseded'].includes(statuses.reforecastStatus)) {
    issues.push(`Pinned forecast is not locked (status: ${statuses.reforecastStatus ?? 'missing'}).`);
  }
  if (statuses.actualsStatus !== 'posted') {
    issues.push(`Pinned actuals batch is not posted (status: ${statuses.actualsStatus ?? 'missing'}).`);
  }
  if (statuses.varianceStatus === null || !['locked', 'superseded'].includes(statuses.varianceStatus)) {
    issues.push(`Variance anchor is not locked (status: ${statuses.varianceStatus ?? 'missing'}).`);
  }

  // 2. Pin consistency: live upstream lock versions/checksums must match what
  //    the variance report pinned at lock time.
  if (values.reforecastLockVersionId !== values.comparatorLockVersionId) {
    issues.push('Forecast lock version no longer matches the variance report pin.');
  }
  if (values.reforecastChecksum !== values.comparatorChecksum) {
    issues.push('Forecast checksum no longer matches the variance report pin.');
  }
  if (values.actualsBatchChecksum !== values.actualsChecksum) {
    issues.push('Actuals checksum no longer matches the variance report pin.');
  }
  if (values.actualsBatchVersionNumber !== values.actualsVersionNumber) {
    issues.push('Actuals version number no longer matches the variance report pin.');
  }
  // Baseline checksum only where the variance report pinned one.
  if (values.baselineChecksum !== null && values.baselineChecksum !== '' &&
      values.budgetBaselineChecksum !== values.baselineChecksum) {
    issues.push('Baseline checksum no longer matches the variance report pin.');
  }

  return issues;
}
