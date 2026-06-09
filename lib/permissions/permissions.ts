import type { Permission, RoleName } from '../../types/roles';
import { roleDefinitions } from './roles.ts';

const permissionByRole = new Map(roleDefinitions.map((role) => [role.name, role.permissions]));

export function hasPermission(roles: RoleName[], permission: Permission): boolean {
  return roles.some((role) => permissionByRole.get(role)?.includes(permission));
}

export function hasAnyPermission(roles: RoleName[], permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(roles, permission));
}

export function requirePermission(roles: RoleName[], permission: Permission): void {
  if (!hasPermission(roles, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
