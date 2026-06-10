import 'server-only';

import { insertAuditEvent } from '../audit/audit-service';
import { createAdminClient } from '../supabase/admin';
import { requirePermission } from '../permissions/permissions';
import { createClient } from '../supabase/server';
import {
  calculateLayer1Output,
  compareLayer1Scenarios,
  starterScenarios
} from '../layer1/calculation-engine';
import type { Layer1ScenarioDefinition } from '../layer1/calculation-types';
import type { UserContext } from '../../types/models';
import type { Json } from '../../types/database';
import {
  demandCategories,
  isDemandCategory,
  isDemandFrequency,
  isScenarioType,
  mapAssumptions,
  mapDemandRows,
  mapScenarioRows,
  nullableString,
  numberFrom
} from '../layer1/row-mappers';
import {
  buildLayer1HandoffPayload,
  buildLayer1VersionSnapshot,
  canApproveLayer1,
  canLockLayer1,
  canSubmitLayer1,
  checksumLayer1Snapshot
} from '../layer1/governance';

export { demandCategories, isDemandCategory, isDemandFrequency, mapAssumptions, mapDemandRows };

export interface Layer1SelectedPlan {
  id: string;
  name: string;
}

export interface Layer1DataSet {
  plan: Layer1SelectedPlan | null;
  plans: Layer1SelectedPlan[];
  briefs: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  demandInputs: Record<string, unknown>[];
  capacityAssumptions: Record<string, unknown>[];
  costAssumptions: Record<string, unknown>[];
  calculationRuns: Record<string, unknown>[];
  scenarios: Layer1ScenarioDefinition[];
}

export async function listLayer1Plans(context: UserContext): Promise<Layer1SelectedPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .select('id, plan_name')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((plan) => ({ id: String(plan.id), name: String(plan.plan_name) }));
}

export async function resolveLayer1Plan(context: UserContext, requestedPlanId?: string | null): Promise<{ plans: Layer1SelectedPlan[]; plan: Layer1SelectedPlan | null }> {
  const plans = await listLayer1Plans(context);
  const plan = plans.find((candidate) => candidate.id === requestedPlanId) ?? plans[0] ?? null;
  return { plans, plan };
}

export async function getLayer1DataSet(context: UserContext, requestedPlanId?: string | null): Promise<Layer1DataSet> {
  const { plans, plan } = await resolveLayer1Plan(context, requestedPlanId);
  if (!plan) {
    return { plan, plans, briefs: [], sources: [], demandInputs: [], capacityAssumptions: [], costAssumptions: [], calculationRuns: [], scenarios: starterScenarios };
  }

  const supabase = await createClient();
  const [briefs, sources, demandInputs, capacityAssumptions, costAssumptions, calculationRuns, scenarioRows] = await Promise.all([
    supabase.from('planning_briefs').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false }),
    supabase.from('source_inventory').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false }),
    supabase.from('demand_inputs').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false }),
    supabase.from('capacity_assumptions').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false }),
    supabase.from('cost_assumptions').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false }),
    supabase.from('calculation_runs').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false }).limit(10),
    supabase.from('scenario_definitions').select('*').eq('organisation_id', context.organisationId).eq('plan_id', plan.id).order('created_at', { ascending: false })
  ]);

  for (const result of [briefs, sources, demandInputs, capacityAssumptions, costAssumptions, calculationRuns, scenarioRows]) {
    if (result.error) throw result.error;
  }

  return {
    plan,
    plans,
    briefs: briefs.data ?? [],
    sources: sources.data ?? [],
    demandInputs: demandInputs.data ?? [],
    capacityAssumptions: capacityAssumptions.data ?? [],
    costAssumptions: costAssumptions.data ?? [],
    calculationRuns: calculationRuns.data ?? [],
    scenarios: mapScenarioRows(scenarioRows.data ?? [])
  };
}

export async function createPlanningBrief(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'layer1:write');
  const supabase = await createClient();
  const payload = {
    organisation_id: context.organisationId,
    plan_id: String(input.plan_id),
    decision_owner: nullableString(input.decision_owner),
    planning_horizon: nullableString(input.planning_horizon),
    service_target: nullableString(input.service_target),
    budget_target: numberFrom(input.budget_target),
    scope_boundary: nullableString(input.scope_boundary),
    success_criteria: nullableString(input.success_criteria),
    status: 'draft',
    created_by: context.userId
  };
  const { data, error } = await supabase.from('planning_briefs').insert(payload).select('id').single();
  if (error) throw error;
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.planning_brief.created', entityType: 'planning_brief', entityId: String(data.id), planId: payload.plan_id, newValue: payload, reason: 'Layer 1 planning brief created' });
  return data;
}

export async function createSourceInventoryItem(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'layer1:write');
  const supabase = await createClient();
  const payload = {
    organisation_id: context.organisationId,
    plan_id: String(input.plan_id),
    source_name: String(input.source_name ?? '').trim(),
    source_type: String(input.source_type ?? 'other'),
    owner: nullableString(input.owner),
    recency: nullableString(input.recency),
    completeness_score: numberFrom(input.completeness_score),
    source_quality_score: numberFrom(input.source_quality_score),
    duplicate_risk: nullableString(input.duplicate_risk),
    approval_status: 'draft',
    created_by: context.userId
  };
  if (!payload.source_name) throw new Error('Source name is required');
  const { data, error } = await supabase.from('source_inventory').insert(payload).select('id').single();
  if (error) throw error;
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.source.created', entityType: 'source_inventory', entityId: String(data.id), planId: payload.plan_id, newValue: payload, reason: 'Layer 1 source inventory item created' });
  return data;
}

export async function createDemandInput(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'layer1:write');
  const category = isDemandCategory(input.demand_category) ? input.demand_category : 'measured_contact';
  const frequency = isDemandFrequency(input.frequency) ? input.frequency : 'monthly';
  const supabase = await createClient();
  const payload = {
    organisation_id: context.organisationId,
    plan_id: String(input.plan_id),
    demand_category: category,
    work_type_label: String(input.work_type_label ?? '').trim(),
    frequency,
    source_id: nullableString(input.source_id),
    demand_volume: numberFrom(input.demand_volume),
    processing_minutes: numberFrom(input.processing_minutes),
    hidden_work_hours: numberFrom(input.hidden_work_hours),
    source_quality_score: numberFrom(input.source_quality_score),
    confidence_score: numberFrom(input.confidence_score),
    rationale: nullableString(input.rationale),
    owner: nullableString(input.owner),
    approval_status: 'draft',
    created_by: context.userId
  };
  if (!payload.work_type_label) throw new Error('Work type is required');
  const { data, error } = await supabase.from('demand_inputs').insert(payload).select('id').single();
  if (error) throw error;
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.demand_input.created', entityType: 'demand_input', entityId: String(data.id), planId: payload.plan_id, newValue: payload, reason: 'Layer 1 demand input created' });
  return data;
}

export async function createLayer1Assumptions(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'layer1:write');
  const supabase = await createClient();
  const planId = String(input.plan_id);
  const capacityPayload = {
    organisation_id: context.organisationId,
    plan_id: planId,
    working_days: numberFrom(input.working_days, 20),
    weeks_per_month: numberFrom(input.weeks_per_month, 4.33),
    hours_per_day: numberFrom(input.hours_per_day, 7.5),
    utilisation: numberFrom(input.utilisation, 82) / 100,
    shrinkage: numberFrom(input.shrinkage, 18) / 100,
    current_supply_fte: numberFrom(input.current_supply_fte),
    confidence_score: numberFrom(input.assumption_confidence, 70),
    assumption_notes: nullableString(input.assumption_notes),
    approval_status: 'draft',
    created_by: context.userId
  };
  const costPayload = {
    organisation_id: context.organisationId,
    plan_id: planId,
    location_or_vendor: nullableString(input.location_or_vendor) ?? 'Blended workforce',
    annual_loaded_cost_per_fte: numberFrom(input.annual_cost_per_fte),
    annual_budget_target: numberFrom(input.annual_budget_target),
    confidence_score: numberFrom(input.assumption_confidence, 70),
    assumption_notes: nullableString(input.assumption_notes),
    approval_status: 'draft',
    created_by: context.userId
  };
  const [capacity, cost] = await Promise.all([
    supabase.from('capacity_assumptions').insert(capacityPayload).select('id').single(),
    supabase.from('cost_assumptions').insert(costPayload).select('id').single()
  ]);
  if (capacity.error) throw capacity.error;
  if (cost.error) throw cost.error;
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.assumptions.created', entityType: 'layer1_assumptions', entityId: String(capacity.data.id), planId, newValue: { capacity: capacityPayload, cost: costPayload }, reason: 'Layer 1 capacity and cost assumptions created' });
  return { capacity: capacity.data, cost: cost.data };
}

export async function createScenarioDefinition(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'layer1:write');
  const supabase = await createClient();
  const scenarioType = isScenarioType(input.scenario_type) ? input.scenario_type : 'custom';
  const payload = {
    organisation_id: context.organisationId,
    plan_id: String(input.plan_id),
    scenario_name: String(input.scenario_name ?? '').trim(),
    scenario_type: scenarioType,
    volume_multiplier: numberFrom(input.volume_multiplier, 1),
    processing_multiplier: numberFrom(input.processing_multiplier, 1),
    hidden_work_multiplier: numberFrom(input.hidden_work_multiplier, 1),
    utilisation_delta: numberFrom(input.utilisation_delta) / 100,
    shrinkage_delta: numberFrom(input.shrinkage_delta) / 100,
    budget_multiplier: numberFrom(input.budget_multiplier, 1),
    status: 'draft',
    created_by: context.userId
  };
  if (!payload.scenario_name) throw new Error('Scenario name is required');
  const { data, error } = await supabase.from('scenario_definitions').insert(payload).select('id').single();
  if (error) throw error;
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.scenario.created', entityType: 'scenario_definition', entityId: String(data.id), planId: payload.plan_id, newValue: payload, reason: 'Layer 1 scenario definition created' });
  return data;
}

export async function runLayer1Calculation(context: UserContext, planId: string) {
  requirePermission(context.roles, 'layer1:write');
  const data = await getLayer1DataSet(context, planId);
  if (!data.plan) throw new Error('Plan is required');
  const demandInputs = mapDemandRows(data.demandInputs, data.sources);
  const assumptions = mapAssumptions(data.capacityAssumptions[0], data.costAssumptions[0], data.briefs[0]);
  if (demandInputs.length === 0) throw new Error('At least one demand input is required before running the calculation');

  const output = calculateLayer1Output(demandInputs, assumptions);
  const scenarioSummary = compareLayer1Scenarios(demandInputs, assumptions, data.scenarios.length > 0 ? data.scenarios : starterScenarios);
  const supabase = await createClient();
  const payload = {
    organisation_id: context.organisationId,
    plan_id: data.plan.id,
    run_type: 'layer1_demand_to_budget',
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
    confidence_score: output.confidenceScore,
    source_quality_score: output.sourceQualityScore,
    risk_flags_json: output.riskFlags,
    calculation_output_json: output,
    scenario_summary_json: scenarioSummary,
    run_status: 'calculated',
    created_by: context.userId
  };
  const { data: run, error } = await supabase.from('calculation_runs').insert(payload).select('id').single();
  if (error) throw error;
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.calculation_run.created', entityType: 'calculation_run', entityId: String(run.id), planId: data.plan.id, newValue: payload, reason: 'Layer 1 deterministic calculation run created' });
  return run;
}


export interface Layer1GovernanceData extends Layer1DataSet {
  versionLocks: Record<string, unknown>[];
  handoffs: Record<string, unknown>[];
  auditEvents: Record<string, unknown>[];
}

async function getLatestFiscalYearId(context: UserContext, planId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fiscal_years')
    .select('id')
    .eq('organisation_id', context.organisationId)
    .eq('plan_id', planId)
    .order('start_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ? String(data[0].id) : null;
}

export async function getLayer1GovernanceData(context: UserContext, requestedPlanId?: string | null): Promise<Layer1GovernanceData> {
  const data = await getLayer1DataSet(context, requestedPlanId);
  if (!data.plan) return { ...data, versionLocks: [], handoffs: [], auditEvents: [] };

  const supabase = await createClient();
  const admin = createAdminClient();
  const [versionLocks, handoffs, auditEvents] = await Promise.all([
    supabase.from('layer1_version_locks').select('*').eq('organisation_id', context.organisationId).eq('plan_id', data.plan.id).order('created_at', { ascending: false }),
    supabase.from('layer1_handoff_objects').select('*').eq('organisation_id', context.organisationId).eq('plan_id', data.plan.id).order('created_at', { ascending: false }),
    admin.from('audit_events').select('*').eq('organisation_id', context.organisationId).eq('plan_id', data.plan.id).like('event_type', 'layer1.%').order('created_at', { ascending: false }).limit(20)
  ]);

  for (const result of [versionLocks, handoffs, auditEvents]) {
    if (result.error) throw result.error;
  }

  return {
    ...data,
    versionLocks: versionLocks.data ?? [],
    handoffs: handoffs.data ?? [],
    auditEvents: auditEvents.data ?? []
  };
}

function latestCalculationRun(data: Layer1DataSet, runId?: string | null): Record<string, unknown> | null {
  if (runId) return data.calculationRuns.find((run) => String(run.id) === runId) ?? null;
  return data.calculationRuns[0] ?? null;
}

function requireCompletedLayer1Inputs(data: Layer1DataSet): void {
  if (!data.plan) throw new Error('Plan is required');
  if (data.demandInputs.length === 0) throw new Error('Demand inputs are required before review submission');
  if (data.capacityAssumptions.length === 0 || data.costAssumptions.length === 0) throw new Error('Capacity and cost assumptions are required before review submission');
  if (data.calculationRuns.length === 0) throw new Error('At least one saved calculation run is required before review submission');
}

export async function submitLayer1ForReview(context: UserContext, input: Record<string, unknown>) {
  if (!canSubmitLayer1(context.roles)) throw new Error('Permission denied: layer1:submit_review');
  const planId = String(input.plan_id ?? '');
  const data = await getLayer1DataSet(context, planId);
  requireCompletedLayer1Inputs(data);
  const run = latestCalculationRun(data, nullableString(input.calculation_run_id));
  if (!run) throw new Error('Calculation run not found');
  if (String(run.run_status) !== 'calculated') throw new Error('Only calculated runs can be submitted for review');

  const admin = createAdminClient();
  const payload = {
    run_status: 'submitted_for_review',
    submitted_by: context.userId,
    submitted_at: new Date().toISOString(),
    review_notes: nullableString(input.review_notes)
  };
  const { data: updated, error } = await admin
    .from('calculation_runs')
    .update(payload)
    .eq('organisation_id', context.organisationId)
    .eq('plan_id', planId)
    .eq('id', String(run.id))
    .select('*')
    .single();
  if (error) throw error;

  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.submitted_for_review', entityType: 'calculation_run', entityId: String(run.id), planId, oldValue: { run_status: run.run_status }, newValue: payload, reason: nullableString(input.review_notes) ?? 'Layer 1 submitted for review' });
  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.approval_requested', entityType: 'calculation_run', entityId: String(run.id), planId, newValue: payload, reason: 'Layer 1 approval requested' });
  return updated;
}

export async function approveLayer1CalculationRun(context: UserContext, input: Record<string, unknown>) {
  if (!canApproveLayer1(context.roles)) throw new Error('Permission denied: layer1:approve');
  const planId = String(input.plan_id ?? '');
  const data = await getLayer1DataSet(context, planId);
  const run = latestCalculationRun(data, nullableString(input.calculation_run_id));
  if (!run) throw new Error('Calculation run not found');
  if (String(run.run_status) !== 'submitted_for_review') throw new Error('Only submitted runs can be approved');

  const admin = createAdminClient();
  const payload = {
    run_status: 'approved',
    approved_by: context.userId,
    approved_at: new Date().toISOString(),
    approval_notes: nullableString(input.approval_notes)
  };
  const { data: updated, error } = await admin
    .from('calculation_runs')
    .update(payload)
    .eq('organisation_id', context.organisationId)
    .eq('plan_id', planId)
    .eq('id', String(run.id))
    .select('*')
    .single();
  if (error) throw error;

  await insertAuditEvent({ organisationId: context.organisationId, actorUserId: context.userId, eventType: 'layer1.approved', entityType: 'calculation_run', entityId: String(run.id), planId, oldValue: { run_status: run.run_status }, newValue: payload, reason: nullableString(input.approval_notes) ?? 'Layer 1 calculation run approved' });
  return updated;
}

export async function createLayer1VersionLockAndHandoff(context: UserContext, input: Record<string, unknown>) {
  if (!canLockLayer1(context.roles)) throw new Error('Permission denied: layer1:lock');
  const planId = String(input.plan_id ?? '');
  const data = await getLayer1GovernanceData(context, planId);
  if (!data.plan) throw new Error('Plan is required');
  const run = latestCalculationRun(data, nullableString(input.calculation_run_id));
  if (!run) throw new Error('Calculation run not found');
  if (String(run.run_status) !== 'approved') throw new Error('Only approved runs can be locked');

  const now = new Date().toISOString();
  const fiscalYearId = await getLatestFiscalYearId(context, planId);
  const snapshot = buildLayer1VersionSnapshot({
    organisationId: context.organisationId,
    planId,
    fiscalYearId,
    calculationRun: run,
    planningBrief: data.briefs[0] ?? null,
    sources: data.sources,
    demandInputs: data.demandInputs,
    capacityAssumption: data.capacityAssumptions[0] ?? null,
    costAssumption: data.costAssumptions[0] ?? null,
    scenarios: data.scenarios,
    approvedBy: String(run.approved_by ?? context.userId),
    approvedAt: String(run.approved_at ?? now),
    lockedBy: context.userId,
    lockedAt: now,
    approvalNotes: nullableString(run.approval_notes) ?? nullableString(input.lock_notes)
  });
  const checksum = checksumLayer1Snapshot(snapshot);
  const admin = createAdminClient();

  const handoffPayload = buildLayer1HandoffPayload(snapshot, { status: 'locked' });
  const { data: rpcResult, error } = await admin.rpc('create_layer1_lock_and_handoff', {
    target_organisation_id: context.organisationId,
    target_plan_id: planId,
    target_calculation_run_id: String(run.id),
    target_actor_user_id: context.userId,
    target_fiscal_year_id: fiscalYearId,
    approved_snapshot: snapshot as unknown as Json,
    handoff_payload: handoffPayload as Json,
    target_checksum: checksum,
    lock_reason: nullableString(input.lock_notes)
  });
  if (error) throw error;
  const result = Array.isArray(rpcResult) ? rpcResult[0] : null;
  if (!result) throw new Error('Layer 1 lock and handoff RPC did not return a result');
  return { versionLock: result.version_lock, handoff: result.handoff };
}

export async function markLayer1HandoffReadyForLayer2(context: UserContext, input: Record<string, unknown>) {
  if (!canLockLayer1(context.roles)) throw new Error('Permission denied: layer1:lock');
  const planId = String(input.plan_id ?? '');
  const handoffId = String(input.handoff_id ?? '');
  if (!handoffId) throw new Error('Handoff id is required');
  const admin = createAdminClient();
  const { data: updated, error } = await admin.rpc('transition_layer1_handoff_status_controlled', {
    target_organisation_id: context.organisationId,
    target_plan_id: planId,
    target_handoff_id: handoffId,
    target_actor_user_id: context.userId,
    next_status: 'ready_for_layer2',
    transition_reason: nullableString(input.ready_notes) ?? 'Layer 1 handoff marked ready for Layer 2 baseline setup'
  });
  if (error) throw error;
  return updated;
}
