import { createHash } from 'node:crypto';

export type BaselineSourceType = 'layer1_handoff' | 'manual';
export type BaselineStatus = 'draft' | 'reviewed' | 'locked' | 'superseded' | 'voided';
export type BaselinePhasingMethod = 'straight_line' | 'custom_manual' | 'working_days_weighted' | 'imported_from_layer1';

export interface BudgetPlanningPeriod {
  id: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

export interface BudgetBaselineAnnuals {
  annualBudgetAmount: number;
  annualRequiredFte: number;
  annualWorkloadHours: number;
  annualLabourCost: number;
  annualSupplyGapFte: number;
}

export interface BudgetBaselineLineDraft {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  workloadHours: number;
  requiredFte: number;
  supplyGapFte: number;
  labourCost: number;
  budgetAmount: number;
  phasingMethod: BaselinePhasingMethod;
  sourceCategory: BaselineSourceType;
  notes: string | null;
}

export interface ReconciliationResult {
  reconciles: boolean;
  budgetDifference: number;
  labourCostDifference: number;
  workloadDifference: number;
}

export interface BudgetBaselineSnapshotInput {
  baseline: Record<string, unknown>;
  lines: Record<string, unknown>[];
  sourceHandoff?: Record<string, unknown> | null;
  lockedBy: string;
  lockedAt: string;
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function distributeAnnualAmount(total: number, periodCount: number): number[] {
  if (periodCount <= 0) return [];
  const roundedTotal = round2(total);
  const base = round2(roundedTotal / periodCount);
  const values = Array.from({ length: periodCount }, () => base);
  const residual = round2(roundedTotal - values.reduce((sum, value) => round2(sum + value), 0));
  values[values.length - 1] = round2(values[values.length - 1] + residual);
  return values;
}

export function createStraightLineBaselineLines(input: {
  periods: BudgetPlanningPeriod[];
  annuals: BudgetBaselineAnnuals;
  sourceCategory: BaselineSourceType;
  phasingMethod?: BaselinePhasingMethod;
  notes?: string | null;
}): BudgetBaselineLineDraft[] {
  const budgetAmounts = distributeAnnualAmount(input.annuals.annualBudgetAmount, input.periods.length);
  const labourCosts = distributeAnnualAmount(input.annuals.annualLabourCost, input.periods.length);
  const workloadHours = distributeAnnualAmount(input.annuals.annualWorkloadHours, input.periods.length);

  return input.periods.map((period, index) => ({
    periodId: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    workloadHours: workloadHours[index] ?? 0,
    requiredFte: round2(input.annuals.annualRequiredFte),
    supplyGapFte: round2(input.annuals.annualSupplyGapFte),
    labourCost: labourCosts[index] ?? 0,
    budgetAmount: budgetAmounts[index] ?? 0,
    phasingMethod: input.phasingMethod ?? 'straight_line',
    sourceCategory: input.sourceCategory,
    notes: input.notes ?? null
  }));
}

export function checkBaselineReconciliation(input: {
  lines: Array<Pick<BudgetBaselineLineDraft, 'budgetAmount' | 'labourCost' | 'workloadHours'>>;
  annualBudgetAmount: number;
  annualLabourCost: number;
  annualWorkloadHours: number;
  tolerance?: number;
}): ReconciliationResult {
  const tolerance = input.tolerance ?? 0.05;
  const budgetSum = round2(input.lines.reduce((sum, line) => sum + Number(line.budgetAmount ?? 0), 0));
  const labourCostSum = round2(input.lines.reduce((sum, line) => sum + Number(line.labourCost ?? 0), 0));
  const workloadSum = round2(input.lines.reduce((sum, line) => sum + Number(line.workloadHours ?? 0), 0));
  const budgetDifference = round2(budgetSum - round2(input.annualBudgetAmount));
  const labourCostDifference = round2(labourCostSum - round2(input.annualLabourCost));
  const workloadDifference = round2(workloadSum - round2(input.annualWorkloadHours));
  return {
    reconciles: Math.abs(budgetDifference) <= tolerance && Math.abs(labourCostDifference) <= tolerance && Math.abs(workloadDifference) <= tolerance,
    budgetDifference,
    labourCostDifference,
    workloadDifference
  };
}

function valueAt(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function annualsFromLayer1Handoff(handoff: Record<string, unknown>): BudgetBaselineAnnuals {
  const workload = asRecord(handoff.workload_outputs_json);
  const requiredFte = asRecord(handoff.required_fte_outputs_json);
  const supplyGap = asRecord(handoff.supply_gap_outputs_json);
  const labourBudget = asRecord(handoff.labour_budget_outputs_json);
  const annualLabourCost = valueAt(labourBudget, ['annual_labour_cost', 'labour_cost']);
  const annualBudgetTarget = valueAt(labourBudget, ['annual_budget_target', 'budget_target']);

  return {
    annualBudgetAmount: annualBudgetTarget || annualLabourCost,
    annualRequiredFte: valueAt(requiredFte, ['required_fte', 'requiredFte']),
    annualWorkloadHours: valueAt(workload, ['total_workload_hours', 'totalWorkloadHours']),
    annualLabourCost,
    annualSupplyGapFte: valueAt(supplyGap, ['supply_gap_fte', 'supplyGapFte']) || valueAt(requiredFte, ['supply_gap_fte', 'supplyGapFte'])
  };
}

export function buildBudgetBaselineSnapshot(input: BudgetBaselineSnapshotInput): Record<string, unknown> {
  return {
    baseline: input.baseline,
    lines: input.lines,
    source_layer1_handoff: input.sourceHandoff ?? null,
    annual_totals: {
      annual_budget_amount: input.baseline.annual_budget_amount ?? 0,
      annual_labour_cost: input.baseline.annual_labour_cost ?? 0,
      annual_required_fte: input.baseline.annual_required_fte ?? 0,
      annual_workload_hours: input.baseline.annual_workload_hours ?? 0,
      annual_supply_gap_fte: input.baseline.annual_supply_gap_fte ?? 0
    },
    monthly_phasing: input.lines.map((line) => ({
      period_id: line.period_id,
      period_start: line.period_start,
      period_end: line.period_end,
      workload_hours: line.workload_hours,
      required_fte: line.required_fte,
      supply_gap_fte: line.supply_gap_fte,
      labour_cost: line.labour_cost,
      budget_amount: line.budget_amount,
      phasing_method: line.phasing_method
    })),
    governance: {
      created_by: input.baseline.created_by ?? null,
      locked_by: input.lockedBy,
      locked_at: input.lockedAt,
      source_type: input.baseline.source_type ?? null,
      source_layer1_handoff_id: input.baseline.source_layer1_handoff_id ?? null,
      source_layer1_version_lock_id: input.baseline.source_layer1_version_lock_id ?? null
    },
    evidence: {
      source_quality_score: input.baseline.source_quality_score ?? null,
      confidence_score: input.baseline.confidence_score ?? null,
      risk_summary_json: input.baseline.risk_summary_json ?? [],
      annualisation_note: input.baseline.annualisation_note ?? null
    }
  };
}

export function checksumBudgetBaselineSnapshot(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
