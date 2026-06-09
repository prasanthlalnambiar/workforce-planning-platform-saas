import { createAdminClient } from '../supabase/admin';
import type { AuditEventInput, AuditEventInsert } from '../../types/models';

export function buildAuditEvent(input: AuditEventInput): AuditEventInsert {
  if (!input.organisationId) throw new Error('organisationId is required for audit events');
  if (!input.actorUserId) throw new Error('actorUserId is required for audit events');
  if (!input.eventType) throw new Error('eventType is required for audit events');
  if (!input.entityType) throw new Error('entityType is required for audit events');

  return {
    organisation_id: input.organisationId,
    actor_user_id: input.actorUserId,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    plan_id: input.planId ?? null,
    fiscal_year_id: input.fiscalYearId ?? null,
    planning_period_id: input.planningPeriodId ?? null,
    old_value_json: input.oldValue ?? null,
    new_value_json: input.newValue ?? null,
    reason: input.reason ?? null,
    request_id: input.requestId ?? null,
    user_agent: input.userAgent ?? null,
    ip_address: input.ipAddress ?? null
  };
}

export async function insertAuditEvent(input: AuditEventInput): Promise<void> {
  const payload = buildAuditEvent(input);
  const supabase = createAdminClient();
  const { error } = await supabase.from('audit_events').insert([payload]);
  if (error) throw error;
}
