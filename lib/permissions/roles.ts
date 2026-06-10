import type { RoleDefinition, RoleName } from '../../types/roles';

export const roleDefinitions: RoleDefinition[] = [
  { name: 'owner', label: 'Owner', description: 'Full workspace ownership and administration.', permissions: ['workspace:read', 'workspace:create_plan', 'workspace:manage_settings', 'fiscal_year:read', 'fiscal_year:write', 'dimensions:read', 'dimensions:write', 'audit:read', 'layer1:read', 'layer1:write', 'layer1:submit_review', 'layer1:approve', 'layer1:lock', 'layer1:approve_lock', 'baseline:read', 'baseline:write', 'integrations:manage', 'ai:manage'] },
  { name: 'admin', label: 'Admin', description: 'Manage users, roles, plans and settings.', permissions: ['workspace:read', 'workspace:create_plan', 'workspace:manage_settings', 'fiscal_year:read', 'fiscal_year:write', 'dimensions:read', 'dimensions:write', 'audit:read', 'layer1:read', 'layer1:write', 'layer1:submit_review', 'layer1:approve', 'layer1:lock', 'layer1:approve_lock', 'baseline:read', 'baseline:write'] },
  { name: 'finance_admin', label: 'Finance Admin', description: 'Finance approvals and budget governance.', permissions: ['workspace:read', 'fiscal_year:read', 'fiscal_year:write', 'dimensions:read', 'audit:read', 'layer1:read', 'layer1:approve', 'layer1:lock', 'layer1:approve_lock', 'baseline:read', 'baseline:write'] },
  { name: 'planner', label: 'Planner', description: 'Create and maintain planning records.', permissions: ['workspace:read', 'workspace:create_plan', 'fiscal_year:read', 'fiscal_year:write', 'dimensions:read', 'dimensions:write', 'layer1:read', 'layer1:write', 'layer1:submit_review', 'baseline:read'] },
  { name: 'reviewer', label: 'Reviewer', description: 'Review plans and outputs.', permissions: ['workspace:read', 'fiscal_year:read', 'dimensions:read', 'layer1:read', 'layer1:approve', 'baseline:read'] },
  { name: 'viewer', label: 'Viewer', description: 'Read-only access.', permissions: ['workspace:read', 'fiscal_year:read', 'dimensions:read', 'layer1:read', 'baseline:read'] },
  { name: 'integration_admin', label: 'Integration Admin', description: 'Manage future actuals integrations.', permissions: ['workspace:read', 'integrations:manage'] },
  { name: 'ai_admin', label: 'AI Admin', description: 'Manage future AI settings.', permissions: ['workspace:read', 'ai:manage'] },
  { name: 'auditor', label: 'Auditor', description: 'View governance and audit evidence.', permissions: ['workspace:read', 'audit:read', 'layer1:read'] }
];

export function isRoleName(value: string): value is RoleName {
  return roleDefinitions.some((role) => role.name === value);
}
