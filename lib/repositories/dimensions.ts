import { insertAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../permissions/permissions';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

export type DimensionTable = 'regions' | 'locations' | 'channels' | 'work_types' | 'workforce_groups';

export async function listDimension(context: UserContext, table: DimensionTable) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createDimension(context: UserContext, table: DimensionTable, values: Record<string, unknown>) {
  requirePermission(context.roles, 'dimensions:write');
  const supabase = await createClient();
  const insertPayload = {
    organisation_id: context.organisationId,
    ...values
  };
  const { data, error } = await supabase.from(table).insert(insertPayload).select('id').single();
  if (error) throw error;
  await insertAuditEvent({
    organisationId: context.organisationId,
    actorUserId: context.userId,
    eventType: `dimension.${table}.created`,
    entityType: table,
    entityId: data.id as string,
    newValue: insertPayload,
    reason: 'Shared dimension created'
  });
  return data;
}
