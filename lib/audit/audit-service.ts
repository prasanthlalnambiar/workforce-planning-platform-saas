import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { buildAuditEvent } from './audit-payload';
import type { AuditEventInput } from '../../types/models';

export { buildAuditEvent } from './audit-payload';

export async function insertAuditEvent(input: AuditEventInput): Promise<void> {
  const payload = buildAuditEvent(input);
  const supabase = createAdminClient();
  const { error } = await supabase.from('audit_events').insert([payload]);
  if (error) throw error;
}
