import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLayer1HandoffPayload,
  buildLayer1VersionSnapshot,
  canApproveLayer1,
  canLockLayer1,
  canSubmitLayer1,
  checksumLayer1Snapshot,
  deriveAssumptionRiskLevel
} from '../lib/layer1/governance';
import { buildAuditEvent } from '../lib/audit/audit-payload';

const calculationRun = {
  id: 'run-1',
  workload_hours: 1000,
  measured_workload_hours: 700,
  estimated_workload_hours: 100,
  hidden_workload_hours: 200,
  productive_hours_per_fte: 123,
  required_fte: 8.13,
  current_supply_fte: 6,
  supply_gap_fte: 2.13,
  weighted_annual_cost_per_fte: 90000,
  annual_labour_cost: 731700,
  annual_budget_target: 650000,
  variance_to_target: 81700,
  source_quality_score: 72,
  confidence_score: 68,
  risk_flags_json: [{ code: 'budget_overrun', severity: 'high', message: 'Budget overrun' }],
  scenario_summary_json: [{ scenarioName: 'Base case', requiredFte: 8.13 }],
  calculation_output_json: {
    annualisationNote: 'Annual labour cost assumes calculated FTE is recurring for the modelled year.',
    workload: { totalWorkloadHours: 1000 },
    riskFlags: [{ code: 'budget_overrun', severity: 'high', message: 'Budget overrun' }]
  },
  approved_by: 'reviewer-1',
  approved_at: '2026-06-10T01:00:00.000Z',
  approval_notes: 'Approved for lock'
};

const snapshotInput = {
  organisationId: 'org-1',
  planId: 'plan-1',
  fiscalYearId: 'fy-1',
  calculationRun,
  planningBrief: { id: 'brief-1', planning_horizon: 'FY2027' },
  sources: [{ id: 'source-1', source_name: 'Stakeholder interviews', source_type: 'stakeholder_interview', source_quality_score: 70 }],
  demandInputs: [
    { id: 'demand-1', demand_category: 'measured_contact', work_type_label: 'Calls', frequency: 'monthly', demand_volume: 1000, processing_minutes: 10, confidence_score: 80, source_quality_score: 75 },
    { id: 'demand-2', demand_category: 'hidden_internal', work_type_label: 'Huddles', frequency: 'weekly', hidden_work_hours: 20, confidence_score: 55, source_quality_score: 45 }
  ],
  capacityAssumption: { working_days: 20, utilisation: 0.82, shrinkage: 0.18 },
  costAssumption: { annual_loaded_cost_per_fte: 90000, annual_budget_target: 650000 },
  scenarios: [],
  approvedBy: 'reviewer-1',
  approvedAt: '2026-06-10T01:00:00.000Z',
  lockedBy: 'finance-1',
  lockedAt: '2026-06-10T02:00:00.000Z',
  approvalNotes: 'Approved for lock'
};

test('Layer 1 governance role helpers separate submit, approve and lock actions', () => {
  assert.equal(canSubmitLayer1(['planner']), true);
  assert.equal(canSubmitLayer1(['viewer']), false);
  assert.equal(canApproveLayer1(['reviewer']), true);
  assert.equal(canApproveLayer1(['finance_admin']), true);
  assert.equal(canApproveLayer1(['viewer']), false);
  assert.equal(canLockLayer1(['finance_admin']), true);
  assert.equal(canLockLayer1(['reviewer']), false);
});

test('builds immutable Layer 1 version snapshot from approved calculation run', () => {
  const snapshot = buildLayer1VersionSnapshot(snapshotInput);
  assert.equal(snapshot.organisation_id, 'org-1');
  assert.equal(snapshot.plan_id, 'plan-1');
  assert.equal(snapshot.fiscal_year_id, 'fy-1');
  assert.equal(snapshot.approved_calculation_run_id, 'run-1');
  assert.equal(snapshot.required_fte_output.required_fte, 8.13);
  assert.equal(snapshot.labour_budget_output.variance_to_target, 81700);
  assert.equal(snapshot.assumption_risk_level, 'high');
  assert.equal(snapshot.demand_input_summary.length, 2);
  assert.equal(snapshot.source_summary.length, 1);
  assert.equal(snapshot.annualisation_note, 'Annual labour cost assumes calculated FTE is recurring for the modelled year.');
});

test('snapshot checksum is deterministic and changes when governed payload changes', () => {
  const first = buildLayer1VersionSnapshot(snapshotInput);
  const second = buildLayer1VersionSnapshot(snapshotInput);
  assert.equal(checksumLayer1Snapshot(first), checksumLayer1Snapshot(second));

  const changed = buildLayer1VersionSnapshot({ ...snapshotInput, approvalNotes: 'Different note' });
  assert.notEqual(checksumLayer1Snapshot(first), checksumLayer1Snapshot(changed));
});

test('handoff payload preserves required fields from approved lock snapshot', () => {
  const snapshot = buildLayer1VersionSnapshot(snapshotInput);
  const handoff = buildLayer1HandoffPayload(snapshot, { versionLockId: 'lock-1', createdBy: 'finance-1', status: 'locked' });
  assert.equal(handoff.organisation_id, 'org-1');
  assert.equal(handoff.plan_id, 'plan-1');
  assert.equal(handoff.fiscal_year_id, 'fy-1');
  assert.equal(handoff.version_lock_id, 'lock-1');
  assert.equal(handoff.approved_calculation_run_id, 'run-1');
  assert.equal(handoff.handoff_status, 'locked');
  assert.deepEqual(handoff.workload_outputs_json, snapshot.workload_output);
  assert.deepEqual(handoff.required_fte_outputs_json, snapshot.required_fte_output);
  assert.deepEqual(handoff.labour_budget_outputs_json, snapshot.labour_budget_output);
  assert.equal(Array.isArray(handoff.demand_inputs_json), true);
  assert.equal(Array.isArray(handoff.hidden_work_inputs_json), true);
  assert.equal((handoff.hidden_work_inputs_json as unknown[]).length, 1);
});

test('governance helper derives assumption risk level from risk flags and confidence', () => {
  assert.equal(deriveAssumptionRiskLevel([], 90), 'low');
  assert.equal(deriveAssumptionRiskLevel([], 65), 'medium');
  assert.equal(deriveAssumptionRiskLevel([{ severity: 'medium' }], 80), 'medium');
  assert.equal(deriveAssumptionRiskLevel([{ severity: 'high' }], 80), 'high');
  assert.equal(deriveAssumptionRiskLevel([], 45), 'high');
});

test('Layer 1 governance audit events preserve actor, entity and reason', () => {
  const event = buildAuditEvent({
    organisationId: 'org-1',
    actorUserId: 'planner-1',
    eventType: 'layer1.submitted_for_review',
    entityType: 'calculation_run',
    entityId: 'run-1',
    oldValue: { run_status: 'calculated' },
    newValue: { run_status: 'submitted_for_review' },
    reason: 'Ready for governance review'
  });
  assert.equal(event.organisation_id, 'org-1');
  assert.equal(event.actor_user_id, 'planner-1');
  assert.equal(event.event_type, 'layer1.submitted_for_review');
  assert.equal(event.entity_type, 'calculation_run');
  assert.equal(event.entity_id, 'run-1');
  assert.deepEqual(event.old_value_json, { run_status: 'calculated' });
  assert.deepEqual(event.new_value_json, { run_status: 'submitted_for_review' });
  assert.equal(event.reason, 'Ready for governance review');
});
