import { createHash } from 'node:crypto';
import type { RoleName } from '../../types/roles';
import { hasPermission } from '../permissions/permissions';

export type Layer1WorkflowStatus = 'draft' | 'calculated' | 'submitted_for_review' | 'approved' | 'locked' | 'ready_for_layer2' | 'superseded';

export interface Layer1GovernanceSnapshotInput {
  organisationId: string;
  planId: string;
  fiscalYearId?: string | null;
  calculationRun: Record<string, unknown>;
  planningBrief?: Record<string, unknown> | null;
  sources: Record<string, unknown>[];
  demandInputs: Record<string, unknown>[];
  capacityAssumption?: Record<string, unknown> | null;
  costAssumption?: Record<string, unknown> | null;
  scenarios: unknown[];
  approvedBy: string;
  approvedAt: string;
  lockedBy?: string | null;
  lockedAt?: string | null;
  approvalNotes?: string | null;
}

export interface Layer1VersionSnapshot {
  organisation_id: string;
  plan_id: string;
  fiscal_year_id: string | null;
  approved_calculation_run_id: string;
  approved_by: string;
  approved_at: string;
  locked_by: string | null;
  locked_at: string | null;
  approval_notes: string | null;
  calculation_output: unknown;
  workload_output: {
    total_workload_hours: unknown;
    measured_workload_hours: unknown;
    estimated_workload_hours: unknown;
    hidden_workload_hours: unknown;
    productive_hours_per_fte: unknown;
  };
  required_fte_output: {
    required_fte: unknown;
    current_supply_fte: unknown;
    supply_gap_fte: unknown;
  };
  labour_budget_output: {
    weighted_annual_cost_per_fte: unknown;
    annual_labour_cost: unknown;
    annual_budget_target: unknown;
    variance_to_target: unknown;
  };
  source_quality_score: unknown;
  confidence_score: unknown;
  assumption_risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_flags: unknown;
  scenario_summary: unknown;
  key_assumptions: {
    capacity: Record<string, unknown> | null;
    cost: Record<string, unknown> | null;
  };
  planning_brief: Record<string, unknown> | null;
  demand_input_summary: Record<string, unknown>[];
  source_summary: Record<string, unknown>[];
  annualisation_note: string | null;
}

export function canSubmitLayer1(roles: RoleName[]): boolean {
  return hasPermission(roles, 'layer1:submit_review') || hasPermission(roles, 'layer1:write');
}

export function canApproveLayer1(roles: RoleName[]): boolean {
  return hasPermission(roles, 'layer1:approve');
}

export function canLockLayer1(roles: RoleName[]): boolean {
  return hasPermission(roles, 'layer1:lock') || hasPermission(roles, 'layer1:approve_lock');
}

export function deriveAssumptionRiskLevel(riskFlags: unknown, confidenceScore: unknown): 'low' | 'medium' | 'high' | 'critical' {
  const flags = Array.isArray(riskFlags) ? riskFlags as Array<Record<string, unknown>> : [];
  if (flags.some((flag) => flag.severity === 'high')) return 'high';
  const confidence = Number(confidenceScore ?? 0);
  if (confidence > 0 && confidence < 50) return 'high';
  if (flags.length > 0 || (confidence > 0 && confidence < 70)) return 'medium';
  return 'low';
}

function summaryRows(rows: Record<string, unknown>[], fields: string[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
}

export function buildLayer1VersionSnapshot(input: Layer1GovernanceSnapshotInput): Layer1VersionSnapshot {
  const output = input.calculationRun.calculation_output_json as Record<string, unknown> | undefined;
  const riskFlags = input.calculationRun.risk_flags_json ?? output?.riskFlags ?? [];
  const scenarioSummary = input.calculationRun.scenario_summary_json ?? [];

  return {
    organisation_id: input.organisationId,
    plan_id: input.planId,
    fiscal_year_id: input.fiscalYearId ?? null,
    approved_calculation_run_id: String(input.calculationRun.id),
    approved_by: input.approvedBy,
    approved_at: input.approvedAt,
    locked_by: input.lockedBy ?? null,
    locked_at: input.lockedAt ?? null,
    approval_notes: input.approvalNotes ?? null,
    calculation_output: output ?? {},
    workload_output: {
      total_workload_hours: input.calculationRun.workload_hours ?? output?.workload,
      measured_workload_hours: input.calculationRun.measured_workload_hours ?? null,
      estimated_workload_hours: input.calculationRun.estimated_workload_hours ?? null,
      hidden_workload_hours: input.calculationRun.hidden_workload_hours ?? null,
      productive_hours_per_fte: input.calculationRun.productive_hours_per_fte ?? null
    },
    required_fte_output: {
      required_fte: input.calculationRun.required_fte ?? null,
      current_supply_fte: input.calculationRun.current_supply_fte ?? null,
      supply_gap_fte: input.calculationRun.supply_gap_fte ?? null
    },
    labour_budget_output: {
      weighted_annual_cost_per_fte: input.calculationRun.weighted_annual_cost_per_fte ?? null,
      annual_labour_cost: input.calculationRun.annual_labour_cost ?? null,
      annual_budget_target: input.calculationRun.annual_budget_target ?? null,
      variance_to_target: input.calculationRun.variance_to_target ?? null
    },
    source_quality_score: input.calculationRun.source_quality_score ?? null,
    confidence_score: input.calculationRun.confidence_score ?? null,
    assumption_risk_level: deriveAssumptionRiskLevel(riskFlags, input.calculationRun.confidence_score),
    risk_flags: riskFlags,
    scenario_summary: scenarioSummary,
    key_assumptions: {
      capacity: input.capacityAssumption ?? null,
      cost: input.costAssumption ?? null
    },
    planning_brief: input.planningBrief ?? null,
    demand_input_summary: summaryRows(input.demandInputs, ['id', 'demand_category', 'work_type_label', 'frequency', 'demand_volume', 'processing_minutes', 'hidden_work_hours', 'confidence_score', 'source_quality_score']),
    source_summary: summaryRows(input.sources, ['id', 'source_name', 'source_type', 'owner', 'recency', 'completeness_score', 'source_quality_score', 'duplicate_risk']),
    annualisation_note: typeof output?.annualisationNote === 'string' ? output.annualisationNote : null
  };
}

export function checksumLayer1Snapshot(snapshot: Layer1VersionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function nextLayer1VersionId(existingVersionCount: number): string {
  return `L1-V${String(existingVersionCount + 1).padStart(3, '0')}`;
}

export function buildLayer1HandoffPayload(snapshot: Layer1VersionSnapshot, input: {
  versionLockId: string;
  createdBy: string;
  status?: 'approved' | 'locked' | 'ready_for_layer2';
}): Record<string, unknown> {
  return {
    organisation_id: snapshot.organisation_id,
    plan_id: snapshot.plan_id,
    fiscal_year_id: snapshot.fiscal_year_id,
    version_lock_id: input.versionLockId,
    approved_calculation_run_id: snapshot.approved_calculation_run_id,
    handoff_status: input.status ?? 'locked',
    source_quality_score: Number(snapshot.source_quality_score ?? 0),
    confidence_score: Number(snapshot.confidence_score ?? 0),
    assumption_risk_level: snapshot.assumption_risk_level,
    demand_inputs_json: snapshot.demand_input_summary,
    hidden_work_inputs_json: snapshot.demand_input_summary.filter((item) => item.demand_category === 'hidden_internal'),
    workload_outputs_json: snapshot.workload_output,
    required_fte_outputs_json: snapshot.required_fte_output,
    supply_gap_outputs_json: { supply_gap_fte: snapshot.required_fte_output.supply_gap_fte },
    labour_budget_outputs_json: snapshot.labour_budget_output,
    scenario_outputs_json: snapshot.scenario_summary,
    key_assumptions_json: snapshot.key_assumptions,
    unresolved_risks_json: snapshot.risk_flags,
    source_summary_json: snapshot.source_summary,
    risk_summary_json: snapshot.risk_flags,
    annualisation_note: snapshot.annualisation_note,
    created_by: input.createdBy,
    is_immutable: true
  };
}
