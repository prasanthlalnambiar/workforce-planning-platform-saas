import 'server-only';

import { insertAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../permissions/permissions';
import { createClient } from '../supabase/server';
import {
  calculateLayer1Output,
  compareLayer1Scenarios,
  starterScenarios
} from '../layer1/calculation-engine';
import type { Layer1ScenarioDefinition } from '../layer1/calculation-types';
import type { UserContext } from '../../types/models';
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
