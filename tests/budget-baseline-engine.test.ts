import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualsFromLayer1Handoff,
  buildBudgetBaselineSnapshot,
  checkBaselineReconciliation,
  checksumBudgetBaselineSnapshot,
  createStraightLineBaselineLines,
  distributeAnnualAmount,
  type BudgetPlanningPeriod
} from '../lib/baseline/baseline-engine';

const periods: BudgetPlanningPeriod[] = Array.from({ length: 12 }, (_, index) => ({
  id: `period-${index + 1}`,
  periodNumber: index + 1,
  periodStart: `2026-${String(index + 1).padStart(2, '0')}-01`,
  periodEnd: `2026-${String(index + 1).padStart(2, '0')}-28`,
  periodLabel: `P${index + 1}`
}));

const annuals = {
  annualBudgetAmount: 1_000_000,
  annualRequiredFte: 42.25,
  annualWorkloadHours: 24_000,
  annualLabourCost: 950_000,
  annualSupplyGapFte: 3.5
};

test('straight-line phasing reconciles annual budget, labour cost and workload totals', () => {
  const lines = createStraightLineBaselineLines({ periods, annuals, sourceCategory: 'manual' });
  const reconciliation = checkBaselineReconciliation({
    lines,
    annualBudgetAmount: annuals.annualBudgetAmount,
    annualLabourCost: annuals.annualLabourCost,
    annualWorkloadHours: annuals.annualWorkloadHours
  });

  assert.equal(lines.length, 12);
  assert.equal(reconciliation.reconciles, true);
  assert.equal(reconciliation.budgetDifference, 0);
  assert.equal(reconciliation.labourCostDifference, 0);
  assert.equal(reconciliation.workloadDifference, 0);
});

test('rounding residual is allocated safely to the final period', () => {
  const values = distributeAnnualAmount(100, 12);
  assert.equal(values.slice(0, 11).every((value) => value === 8.33), true);
  assert.equal(values[11], 8.37);
  assert.equal(values.reduce((sum, value) => Math.round((sum + value) * 100) / 100, 0), 100);
});

test('custom monthly phasing reconciliation detects unreconciled annual totals', () => {
  const lines = createStraightLineBaselineLines({ periods, annuals, sourceCategory: 'manual' });
  const brokenLines = lines.map((line, index) => index === 0 ? { ...line, budgetAmount: line.budgetAmount + 10 } : line);
  const reconciliation = checkBaselineReconciliation({
    lines: brokenLines,
    annualBudgetAmount: annuals.annualBudgetAmount,
    annualLabourCost: annuals.annualLabourCost,
    annualWorkloadHours: annuals.annualWorkloadHours
  });

  assert.equal(reconciliation.reconciles, false);
  assert.equal(reconciliation.budgetDifference, 10);
});

test('annuals from Layer 1 handoff preserve approved workload, FTE, gap and budget outputs', () => {
  const handoff = {
    workload_outputs_json: { total_workload_hours: 15000 },
    required_fte_outputs_json: { required_fte: 28.4 },
    supply_gap_outputs_json: { supply_gap_fte: 4.2 },
    labour_budget_outputs_json: { annual_labour_cost: 2_700_000, annual_budget_target: 2_600_000 }
  };

  assert.deepEqual(annualsFromLayer1Handoff(handoff), {
    annualBudgetAmount: 2_600_000,
    annualRequiredFte: 28.4,
    annualWorkloadHours: 15000,
    annualLabourCost: 2_700_000,
    annualSupplyGapFte: 4.2
  });
});

test('budget baseline snapshot checksum is deterministic and changes with governed payload', () => {
  const baseline = { id: 'baseline-1', annual_budget_amount: 100, source_type: 'manual', created_by: 'user-1' };
  const lines = [{ id: 'line-1', period_id: 'p1', budget_amount: 100 }];
  const first = buildBudgetBaselineSnapshot({ baseline, lines, lockedBy: 'user-1', lockedAt: '2026-06-10T00:00:00.000Z' });
  const second = buildBudgetBaselineSnapshot({ baseline, lines, lockedBy: 'user-1', lockedAt: '2026-06-10T00:00:00.000Z' });
  const changed = buildBudgetBaselineSnapshot({ baseline: { ...baseline, annual_budget_amount: 101 }, lines, lockedBy: 'user-1', lockedAt: '2026-06-10T00:00:00.000Z' });

  assert.equal(checksumBudgetBaselineSnapshot(first), checksumBudgetBaselineSnapshot(second));
  assert.notEqual(checksumBudgetBaselineSnapshot(first), checksumBudgetBaselineSnapshot(changed));
});
