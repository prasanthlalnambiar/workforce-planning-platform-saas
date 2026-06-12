export const roleNames = [
  'owner',
  'admin',
  'finance_admin',
  'planner',
  'reviewer',
  'viewer',
  'integration_admin',
  'ai_admin',
  'auditor'
] as const;

export type RoleName = (typeof roleNames)[number];

export type Permission =
  | 'workspace:read'
  | 'workspace:create_plan'
  | 'workspace:manage_settings'
  | 'fiscal_year:read'
  | 'fiscal_year:write'
  | 'dimensions:read'
  | 'dimensions:write'
  | 'audit:read'
  | 'layer1:read'
  | 'layer1:write'
  | 'layer1:submit_review'
  | 'layer1:approve'
  | 'layer1:lock'
  | 'layer1:approve_lock'
  | 'baseline:read'
  | 'baseline:write'
  | 'baseline:create'
  | 'baseline:review'
  | 'baseline:lock'
  | 'driver:read'
  | 'driver:write'
  | 'driver:propose'
  | 'driver:approve'
  | 'driver:supersede'
  | 'reforecast:read'
  | 'reforecast:create'
  | 'reforecast:write'
  | 'reforecast:submit'
  | 'reforecast:lock'
  | 'reforecast:void'
  | 'integrations:manage'
  | 'ai:manage';

export interface RoleDefinition {
  name: RoleName;
  label: string;
  description: string;
  permissions: Permission[];
}
