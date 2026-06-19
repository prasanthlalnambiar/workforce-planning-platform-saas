// Phase 7 Actuals + Variance Module — deterministic engine.
//
// Actuals map strictly to existing planning periods (no silent mappings) and are
// versioned: posted actuals are immutable and corrections supersede. Variance is
// computed as actual − comparator against a PINNED locked forecast version
// (lock_version_id + checksum) and the locked baseline, so later forecast locks
// never rewrite an existing variance report. No AI generates official numbers
// and no calculation logic lives in React components.

import { createHash } from 'node:crypto';
import { round2 } from '../drivers/driver-engine';

export type ActualsBatchStatus = 'draft' | 'validated' | 'posted' | 'superseded' | 'voided';
export type VarianceReportStatus = 'draft' | 'locked' | 'superseded' | 'voided';

export interface PlanningPeriodRef {
  id: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

export interface ActualsLineDraft {
  planningPeriodId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  actualCost: number;
  actualFte: number;
  actualWorkloadHours: number;
  sourceRowReference: string | null;
}

export interface ActualsValidationIssue {
  rowReference: string;
  message: string;
}

/**
 * Validate actuals rows against the planning periods of the selected baseline
 * horizon. Rows are rejected — never silently remapped — when the period is
 * missing/unknown, the period sits outside the horizon, values are not finite
 * numbers, or the same period appears twice.
 */
export function validateActualsLines(input: {
  horizonPeriods: PlanningPeriodRef[];
  lines: ActualsLineDraft[];
}): ActualsValidationIssue[] {
  const issues: ActualsValidationIssue[] = [];
  const horizonById = new Map(input.horizonPeriods.map((period) => [period.id, period]));
  const seen = new Set<string>();

  if (input.lines.length === 0) {
    issues.push({ rowReference: 'batch', message: 'At least one actuals row is required' });
    return issues;
  }

  for (const line of input.lines) {
    const ref = line.sourceRowReference ?? `period ${line.periodNumber}`;
    if (!horizonById.has(line.planningPeriodId)) {
      issues.push({ rowReference: ref, message: 'Period does not exist in the selected baseline horizon for this organisation' });
      continue;
    }
    if (seen.has(line.planningPeriodId)) {
      issues.push({ rowReference: ref, message: 'Duplicate planning period: each period may appear only once per batch' });
      continue;
    }
    seen.add(line.planningPeriodId);
    for (const [field, value] of [['actual cost', line.actualCost], ['actual FTE', line.actualFte], ['actual workload hours', line.actualWorkloadHours]] as const) {
      if (!Number.isFinite(value)) {
        issues.push({ rowReference: ref, message: `Invalid ${field}: must be a finite number` });
      }
    }
  }
  return issues;
}

/**
 * Strict CSV mapping. Expected row shape: YYYY-MM,cost,fte,workload_hours.
 * Each month token must exactly match the calendar month of one planning
 * period's start date in the horizon; anything else is a rejection, never a
 * silent best-effort mapping.
 */
export function mapCsvRowsToActualsLines(input: {
  horizonPeriods: PlanningPeriodRef[];
  csvText: string;
}): { lines: ActualsLineDraft[]; issues: ActualsValidationIssue[] } {
  const issues: ActualsValidationIssue[] = [];
  const lines: ActualsLineDraft[] = [];
  const periodByMonth = new Map(
    input.horizonPeriods.map((period) => [period.periodStart.slice(0, 7), period])
  );

  const rows = input.csvText
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0 && !row.toLowerCase().startsWith('month'));

  rows.forEach((row, index) => {
    const ref = `csv row ${index + 1}`;
    const parts = row.split(',').map((part) => part.trim());
    if (parts.length < 2) {
      issues.push({ rowReference: ref, message: 'Row must be: YYYY-MM,cost[,fte[,workload_hours]]' });
      return;
    }
    const monthToken = parts[0];
    if (!/^\d{4}-\d{2}$/.test(monthToken)) {
      issues.push({ rowReference: ref, message: `Month format "${monthToken}" cannot be mapped: expected YYYY-MM` });
      return;
    }
    const period = periodByMonth.get(monthToken);
    if (!period) {
      issues.push({ rowReference: ref, message: `Month ${monthToken} has no planning period in the selected baseline horizon` });
      return;
    }
    const [cost, fte, hours] = [parts[1], parts[2] ?? '0', parts[3] ?? '0'].map((part) => Number(part));
    lines.push({
      planningPeriodId: period.id,
      periodNumber: period.periodNumber,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actualCost: Number.isFinite(cost) ? round2(cost) : Number.NaN,
      actualFte: Number.isFinite(fte) ? round2(fte) : Number.NaN,
      actualWorkloadHours: Number.isFinite(hours) ? round2(hours) : Number.NaN,
      sourceRowReference: ref
    });
  });

  if (lines.length > 0 || issues.length === 0) {
    issues.push(...validateActualsLines({ horizonPeriods: input.horizonPeriods, lines }));
  }
  return { lines, issues };
}

/** Deterministic checksum of an actuals batch: changes whenever any value changes. */
export function computeActualsChecksum(lines: ActualsLineDraft[]): string {
  const canonical = [...lines]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((line) => [
      line.planningPeriodId, line.periodNumber,
      line.actualCost.toFixed(2), line.actualFte.toFixed(2), line.actualWorkloadHours.toFixed(2)
    ].join('|'))
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// Variance calculation
// ---------------------------------------------------------------------------

export interface ComparatorLine {
  planningPeriodId: string;
  cost: number;
  fte: number;
  workloadHours: number;
}

export interface VarianceLineDraft {
  planningPeriodId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  actualCost: number;
  forecastCost: number;
  baselineCost: number;
  costVarianceToForecast: number;
  costVarianceToForecastPct: number | null;
  costVarianceToBaseline: number;
  costVarianceToBaselinePct: number | null;
  actualFte: number;
  forecastFte: number;
  baselineFte: number;
  fteVarianceToForecast: number;
  fteVarianceToBaseline: number;
  actualWorkloadHours: number;
  forecastWorkloadHours: number;
  baselineWorkloadHours: number;
  workloadVarianceToForecast: number;
  workloadVarianceToBaseline: number;
}

/** variance% = variance / comparator * 100; a zero comparator yields null, never a division blow-up. */
export function safeVariancePct(variance: number, comparator: number): number | null {
  if (comparator === 0) return null;
  return round2((variance / comparator) * 100);
}

/**
 * Variance = actual − comparator. Positive cost variance means actual cost is
 * HIGHER than the comparator (over forecast / over baseline); negative means
 * lower. Lines are produced for the periods covered by the actuals batch.
 */
export function buildVarianceLines(input: {
  actualLines: ActualsLineDraft[];
  forecastLines: ComparatorLine[];
  baselineLines: ComparatorLine[];
}): VarianceLineDraft[] {
  const forecastByPeriod = new Map(input.forecastLines.map((line) => [line.planningPeriodId, line]));
  const baselineByPeriod = new Map(input.baselineLines.map((line) => [line.planningPeriodId, line]));

  return [...input.actualLines]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((actual) => {
      const forecast = forecastByPeriod.get(actual.planningPeriodId);
      const baseline = baselineByPeriod.get(actual.planningPeriodId);
      if (!forecast) {
        throw new Error(`Variance rejected: period ${actual.periodNumber} has no line in the pinned locked forecast`);
      }
      if (!baseline) {
        throw new Error(`Variance rejected: period ${actual.periodNumber} has no line in the locked baseline`);
      }
      const costVarF = round2(actual.actualCost - forecast.cost);
      const costVarB = round2(actual.actualCost - baseline.cost);
      return {
        planningPeriodId: actual.planningPeriodId,
        periodNumber: actual.periodNumber,
        periodStart: actual.periodStart,
        periodEnd: actual.periodEnd,
        actualCost: round2(actual.actualCost),
        forecastCost: round2(forecast.cost),
        baselineCost: round2(baseline.cost),
        costVarianceToForecast: costVarF,
        costVarianceToForecastPct: safeVariancePct(costVarF, round2(forecast.cost)),
        costVarianceToBaseline: costVarB,
        costVarianceToBaselinePct: safeVariancePct(costVarB, round2(baseline.cost)),
        actualFte: round2(actual.actualFte),
        forecastFte: round2(forecast.fte),
        baselineFte: round2(baseline.fte),
        fteVarianceToForecast: round2(actual.actualFte - forecast.fte),
        fteVarianceToBaseline: round2(actual.actualFte - baseline.fte),
        actualWorkloadHours: round2(actual.actualWorkloadHours),
        forecastWorkloadHours: round2(forecast.workloadHours),
        baselineWorkloadHours: round2(baseline.workloadHours),
        workloadVarianceToForecast: round2(actual.actualWorkloadHours - forecast.workloadHours),
        workloadVarianceToBaseline: round2(actual.actualWorkloadHours - baseline.workloadHours)
      };
    });
}

export interface VarianceTotals {
  actualCost: number;
  forecastCost: number;
  baselineCost: number;
  costVarianceToForecast: number;
  costVarianceToForecastPct: number | null;
  costVarianceToBaseline: number;
  costVarianceToBaselinePct: number | null;
  fteVarianceToForecast: number;
  fteVarianceToBaseline: number;
  workloadVarianceToForecast: number;
  workloadVarianceToBaseline: number;
  periodCount: number;
}

export function summariseVariance(lines: VarianceLineDraft[]): VarianceTotals {
  const sum = (select: (line: VarianceLineDraft) => number) => lines.reduce((total, line) => round2(total + select(line)), 0);
  const actualCost = sum((line) => line.actualCost);
  const forecastCost = sum((line) => line.forecastCost);
  const baselineCost = sum((line) => line.baselineCost);
  const costVarF = round2(actualCost - forecastCost);
  const costVarB = round2(actualCost - baselineCost);
  return {
    actualCost,
    forecastCost,
    baselineCost,
    costVarianceToForecast: costVarF,
    costVarianceToForecastPct: safeVariancePct(costVarF, forecastCost),
    costVarianceToBaseline: costVarB,
    costVarianceToBaselinePct: safeVariancePct(costVarB, baselineCost),
    fteVarianceToForecast: sum((line) => line.fteVarianceToForecast),
    fteVarianceToBaseline: sum((line) => line.fteVarianceToBaseline),
    workloadVarianceToForecast: sum((line) => line.workloadVarianceToForecast),
    workloadVarianceToBaseline: sum((line) => line.workloadVarianceToBaseline),
    periodCount: lines.length
  };
}

/**
 * Deterministic checksum of a variance report including its pinned comparators.
 * The pins are part of the hash: a variance against a different forecast lock
 * version is, by construction, a different report.
 */
export function computeVarianceChecksum(
  lines: VarianceLineDraft[],
  pins: {
    comparatorLockVersionId: string;
    comparatorChecksum: string;
    baselineChecksum: string | null;
    actualsChecksum: string;
    actualsVersionNumber: number;
  }
): string {
  const canonical = [...lines]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((line) => [
      line.planningPeriodId, line.periodNumber,
      line.actualCost.toFixed(2), line.forecastCost.toFixed(2), line.baselineCost.toFixed(2),
      line.costVarianceToForecast.toFixed(2), line.costVarianceToBaseline.toFixed(2),
      line.fteVarianceToForecast.toFixed(2), line.fteVarianceToBaseline.toFixed(2),
      line.workloadVarianceToForecast.toFixed(2), line.workloadVarianceToBaseline.toFixed(2)
    ].join('|'))
    .join('\n');
  // The baseline checksum and actuals version number are part of the hash:
  // the variance lock is explicitly tied to the baseline artifact and the
  // exact actuals version, not only to copied line values.
  return createHash('sha256')
    .update(`${pins.comparatorLockVersionId}|${pins.comparatorChecksum}|${pins.baselineChecksum ?? ''}|${pins.actualsChecksum}|${pins.actualsVersionNumber}\n${canonical}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Lifecycle governance matrices (mirror the database RPC rules)
// ---------------------------------------------------------------------------

const actualsTransitions: Record<ActualsBatchStatus, ActualsBatchStatus[]> = {
  draft: ['validated', 'voided'],
  validated: ['draft', 'posted', 'voided'],
  posted: ['superseded', 'voided'],
  superseded: [],
  voided: []
};

export function canTransitionActualsStatus(from: ActualsBatchStatus, to: ActualsBatchStatus): boolean {
  return (actualsTransitions[from] ?? []).includes(to);
}

export function isActualsBatchEditable(status: ActualsBatchStatus): boolean {
  return status === 'draft';
}

export function isActualsBatchImmutable(status: ActualsBatchStatus): boolean {
  return status === 'posted' || status === 'superseded' || status === 'voided';
}

const varianceTransitions: Record<VarianceReportStatus, VarianceReportStatus[]> = {
  draft: ['locked', 'voided'],
  locked: ['superseded', 'voided'],
  superseded: [],
  voided: []
};

export function canTransitionVarianceStatus(from: VarianceReportStatus, to: VarianceReportStatus): boolean {
  return (varianceTransitions[from] ?? []).includes(to);
}

export function isVarianceRecalculable(status: VarianceReportStatus): boolean {
  return status === 'draft';
}

export function isVarianceImmutable(status: VarianceReportStatus): boolean {
  return status === 'locked' || status === 'superseded' || status === 'voided';
}
