import { insertAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../permissions/permissions';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

export async function listPlans(context: UserContext) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .select('id, organisation_id, plan_name, plan_description, plan_type, status, created_at')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPlan(context: UserContext, input: { planName: string; description?: string }) {
  requirePermission(context.roles, 'workspace:create_plan');
  const supabase = await createClient();
  const planInsert = {
    organisation_id: context.organisationId,
    plan_name: input.planName.trim(),
    plan_description: input.description?.trim() || null,
    plan_type: 'workforce_budget_governance',
    status: 'draft',
    created_by: context.userId
  };
  if (!planInsert.plan_name) throw new Error('Plan name is required');

  const { data, error } = await supabase.from('plans').insert(planInsert).select('id').single();
  if (error) throw error;

  await insertAuditEvent(supabase, {
    organisationId: context.organisationId,
    actorUserId: context.userId,
    eventType: 'plan.created',
    entityType: 'plan',
    entityId: data.id as string,
    planId: data.id as string,
    newValue: planInsert,
    reason: 'Plan created from Phase 1 workspace'
  });

  return data;
}
