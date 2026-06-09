import { requirePermission } from '../permissions/permissions';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

export async function listAuditEvents(context: UserContext) {
  requirePermission(context.roles, 'audit:read');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, event_type, entity_type, entity_id, reason, created_at')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}
