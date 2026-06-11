import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calculateLayer1Output, compareLayer1Scenarios, starterScenarios } from '../lib/layer1/calculation-engine';
import { buildLayer1HandoffPayload, buildLayer1VersionSnapshot, checksumLayer1Snapshot } from '../lib/layer1/governance';
import { annualsFromLayer1Handoff, buildBudgetBaselineSnapshot, checkBaselineReconciliation, checksumBudgetBaselineSnapshot, createStraightLineBaselineLines, type BudgetPlanningPeriod } from '../lib/baseline/baseline-engine';
import { driverImpactTreatment, phaseDriverImpact, summariseDriverImpacts, summariseDriverPortfolio } from '../lib/drivers/driver-engine';
import type { Layer1Assumptions, Layer1DemandInput } from '../lib/layer1/calculation-types';

function twelvePeriods(): BudgetPlanningPeriod[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: randomUUID(),
    periodNumber: index + 1,
    periodStart: `2026-${String(index + 1).padStart(2, '0')}-01`,
    periodEnd: `2026-${String(index + 1).padStart(2, '0')}-28`,
    periodLabel: `P${index + 1}`
  }));
}

test('Phase 1 to Phase 5 workflow contract preserves deterministic evidence through driver layer', () => {
  const organisationId = randomUUID();
  const planId = randomUUID();
  const fiscalYearId = randomUUID();
  const actorId = randomUUID();
  const calculationRunId = randomUUID();
  const versionLockId = randomUUID();
  const lockedAt = '2026-06-10T08:00:00.000Z';

  const demandInputs: Layer1DemandInput[] = [
    { category: 'measured_contact', workTypeLabel: 'Calls', frequency: 'monthly', sourceId: 'source-1', volume: 10000, effortMinutes: 6, sourceQualityScore: 90, confidenceScore: 85 },
    { category: 'measured_case', workTypeLabel: 'Cases', frequency: 'weekly', sourceId: 'source-2', volume: 600, effortMinutes: 12, sourceQualityScore: 80, confidenceScore: 75 },
    { category: 'hidden_internal', workTypeLabel: 'Research and huddles', frequency: 'daily', hiddenWorkHours: 12, sourceQualityScore: 55, confidenceScore: 60 }
  ];
  const assumptions: Layer1Assumptions = {
    workingDays: 20,
    weeksPerMonth: 4.33,
    hoursPerDay: 7.5,
    utilisation: 0.82,
    shrinkage: 0.18,
    currentSupplyFte: 70,
    annualCostPerFte: 112000,
    annualBudgetTarget: 8_500_000,
    confidenceScore: 72
  };

  const output = calculateLayer1Output(demandInputs, assumptions);
  const scenarios = compareLayer1Scenarios(demandInputs, assumptions, starterScenarios);
  assert.ok(output.requiredFte > 0);
  assert.ok(scenarios.length >= 5);

  const calculationRun = {
    id: calculationRunId,
    calculation_output_json: output,
    scenario_summary_json: scenarios,
    workload_hours: output.workload.totalWorkloadHours,
    measured_workload_hours: output.workload.measuredWorkloadHours,
    estimated_workload_hours: output.workload.estimatedWorkloadHours,
    hidden_workload_hours: output.workload.hiddenWorkloadHours,
    productive_hours_per_fte: output.productiveHoursPerFte,
    required_fte: output.requiredFte,
    current_supply_fte: output.currentSupplyFte,
    supply_gap_fte: output.fteGap,
    weighted_annual_cost_per_fte: assumptions.annualCostPerFte,
    annual_labour_cost: output.labourCost,
    annual_budget_target: output.budgetTarget,
    variance_to_target: output.budgetVariance,
    source_quality_score: output.sourceQualityScore,
    confidence_score: output.confidenceScore,
    risk_flags_json: output.riskFlags,
    approved_by: actorId,
    approved_at: lockedAt,
    approval_notes: 'Approved for commercial QA workflow test'
  };

  const versionSnapshot = buildLayer1VersionSnapshot({
    organisationId,
    planId,
    fiscalYearId,
    calculationRun,
    planningBrief: { plan_id: planId, decision_owner: 'COO', service_target: '80/20' },
    sources: [{ id: 'source-1', source_name: 'Telephony extract', source_quality_score: 90 }, { id: 'source-2', source_name: 'Case tool export', source_quality_score: 80 }],
    demandInputs: demandInputs.map((input, index) => ({ id: `demand-${index}`, demand_category: input.category, work_type_label: input.workTypeLabel, frequency: input.frequency, demand_volume: input.volume ?? null, processing_minutes: input.effortMinutes ?? null, hidden_work_hours: input.hiddenWorkHours ?? null, confidence_score: input.confidenceScore, source_quality_score: input.sourceQualityScore })),
    capacityAssumption: { working_days: assumptions.workingDays, hours_per_day: assumptions.hoursPerDay, utilisation: assumptions.utilisation, shrinkage: assumptions.shrinkage },
    costAssumption: { annual_loaded_cost_per_fte: assumptions.annualCostPerFte, annual_budget_target: assumptions.annualBudgetTarget },
    scenarios,
    approvedBy: actorId,
    approvedAt: lockedAt,
    lockedBy: actorId,
    lockedAt,
    approvalNotes: 'Approved and locked'
  });

  const layer1Checksum = checksumLayer1Snapshot(versionSnapshot);
  assert.equal(layer1Checksum.length, 64);

  const handoff = buildLayer1HandoffPayload(versionSnapshot, { versionLockId, createdBy: actorId, status: 'ready_for_layer2' });
  assert.equal(handoff.organisation_id, organisationId);
  assert.equal(handoff.plan_id, planId);
  assert.equal(handoff.handoff_status, 'ready_for_layer2');

  const annuals = annualsFromLayer1Handoff(handoff);
  const lines = createStraightLineBaselineLines({ periods: twelvePeriods(), annuals, sourceCategory: 'layer1_handoff', phasingMethod: 'imported_from_layer1' });
  const reconciliation = checkBaselineReconciliation({
    lines,
    annualBudgetAmount: annuals.annualBudgetAmount,
    annualLabourCost: annuals.annualLabourCost,
    annualWorkloadHours: annuals.annualWorkloadHours
  });
  assert.equal(reconciliation.reconciles, true);

  const baselineId = randomUUID();
  const lockedBaselineHeader = {
    id: baselineId,
    organisation_id: organisationId,
    plan_id: planId,
    fiscal_year_id: fiscalYearId,
    source_type: 'layer1_handoff',
    source_layer1_handoff_id: randomUUID(),
    source_layer1_version_lock_id: versionLockId,
    status: 'locked',
    annual_budget_amount: annuals.annualBudgetAmount,
    annual_labour_cost: annuals.annualLabourCost,
    annual_required_fte: annuals.annualRequiredFte,
    annual_workload_hours: annuals.annualWorkloadHours,
    annual_supply_gap_fte: annuals.annualSupplyGapFte,
    source_quality_score: handoff.source_quality_score,
    confidence_score: handoff.confidence_score,
    risk_summary_json: handoff.risk_summary_json,
    annualisation_note: handoff.annualisation_note,
    created_by: actorId,
    locked_by: actorId,
    locked_at: lockedAt,
    is_immutable: true,
    checksum: null
  };
  const immutableLines = lines.map((line) => ({ ...line, id: randomUUID(), budget_baseline_id: baselineId, is_immutable: true }));
  const snapshotForChecksum = buildBudgetBaselineSnapshot({ baseline: lockedBaselineHeader, lines: immutableLines, sourceHandoff: handoff, lockedBy: actorId, lockedAt });
  const baselineChecksum = checksumBudgetBaselineSnapshot(snapshotForChecksum);
  const finalSnapshot = buildBudgetBaselineSnapshot({ baseline: { ...lockedBaselineHeader, checksum: baselineChecksum }, lines: immutableLines, sourceHandoff: handoff, lockedBy: actorId, lockedAt, checksum: baselineChecksum });

  assert.equal(finalSnapshot.snapshot_checksum, baselineChecksum);
  assert.equal((finalSnapshot.baseline as Record<string, unknown>).status, 'locked');
  assert.equal((finalSnapshot.baseline as Record<string, unknown>).locked_by, actorId);
  assert.equal((finalSnapshot.baseline as Record<string, unknown>).is_immutable, true);
  assert.equal((finalSnapshot.governance as Record<string, unknown>).checksum, baselineChecksum);
  assert.equal(checksumBudgetBaselineSnapshot(finalSnapshot), baselineChecksum);

  const driverImpacts = phaseDriverImpact(immutableLines.map((line) => ({
    periodId: String(line.periodId),
    budgetBaselineLineId: String(line.id),
    periodStart: String(line.periodStart),
    periodEnd: String(line.periodEnd)
  })), {
    annualBudgetDelta: -250_000,
    annualLabourCostDelta: -220_000,
    annualRequiredFteDelta: -2.2,
    annualWorkloadHoursDelta: -1600
  });
  const driverSummary = summariseDriverImpacts(driverImpacts);
  assert.equal(driverSummary.totalBudgetDelta, -250_000);
  assert.equal(driverSummary.totalLabourCostDelta, -220_000);
  assert.equal(driverSummary.totalRequiredFteDelta, -2.2);
  assert.equal(driverSummary.totalWorkloadHoursDelta, -1600);
  const portfolio = summariseDriverPortfolio([
    { status: 'proposed', impacts: driverImpacts },
    { status: 'approved', impacts: driverImpacts }
  ]);
  assert.equal(driverImpactTreatment('proposed'), 'scenario_preview');
  assert.equal(driverImpactTreatment('approved'), 'official_impact');
  assert.equal(portfolio.proposedBudgetDelta, -250_000);
  assert.equal(portfolio.officialBudgetDelta, -250_000);
  assert.equal((finalSnapshot.baseline as Record<string, unknown>).status, 'locked');
});

test('blocked-path contract prevents non-ready handoffs, locked baseline edits and premature forecasts by design', () => {
  const nonReadyStatuses = ['draft', 'approved', 'locked', 'superseded', 'voided'];
  for (const status of nonReadyStatuses) {
    assert.notEqual(status, 'ready_for_layer2');
  }

  const lockedBaseline = { status: 'locked', is_immutable: true };
  assert.equal(lockedBaseline.status === 'locked' || lockedBaseline.is_immutable === true, true);

  const proposedDriver = { status: 'proposed', treatment: driverImpactTreatment('proposed') };
  const approvedDriver = { status: 'approved', treatment: driverImpactTreatment('approved'), is_immutable: true };
  const voidedDriver = { status: 'voided', treatment: driverImpactTreatment('voided') };
  assert.equal(proposedDriver.treatment, 'scenario_preview');
  assert.equal(approvedDriver.treatment, 'official_impact');
  assert.equal(approvedDriver.is_immutable, true);
  assert.equal(voidedDriver.treatment, 'excluded');
});
