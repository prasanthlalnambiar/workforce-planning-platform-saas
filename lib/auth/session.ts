import { redirect } from 'next/navigation';
import { createClient } from '../supabase/server';
import { isRoleName } from '../permissions/roles';
import type { RoleName } from '../../types/roles';
import type { UserContext } from '../../types/models';

interface MembershipRow {
  organisation_id: string;
  organisations?: { name?: string } | null;
}

interface RoleRow {
  roles?: { role_name?: string } | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string | null;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  return {
    id: userData.user.id,
    email: userData.user.email ?? '',
    fullName: (userData.user.user_metadata?.full_name as string | undefined) ?? (userData.user.user_metadata?.name as string | undefined) ?? null
  };
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect('/login');
  return user;
}

export async function getCurrentUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,full_name,default_organisation_id')
    .eq('id', userData.user.id)
    .single();

  if (profileError) {
    // UAT hardening: never silently degrade a failed auth-context query.
    console.error('Auth context error: profile query failed', profileError.message);
    throw new Error(`Auth context error: failed to load profile (${profileError.message})`);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('organisation_memberships')
    .select('organisation_id, organisations(name)')
    .eq('user_id', userData.user.id)
    .eq('status', 'active')
    .limit(1) as { data: MembershipRow[] | null; error: { message: string } | null };

  if (membershipError) {
    console.error('Auth context error: membership query failed', membershipError.message);
    throw new Error(`Auth context error: failed to load organisation membership (${membershipError.message})`);
  }

  const organisationId = (profile?.default_organisation_id as string | undefined) || memberships?.[0]?.organisation_id;
  if (!organisationId) return null;

  // The roles embed names the FK constraint explicitly: user_roles has more
  // than one relationship path to roles, and the bare roles(role_name) embed
  // is ambiguous.
  const { data: userRoles, error: roleError } = await supabase
    .from('user_roles')
    .select('roles!user_roles_role_same_org_fk(role_name)')
    .eq('user_id', userData.user.id)
    .eq('organisation_id', organisationId) as { data: RoleRow[] | null; error: { message: string } | null };

  if (roleError) {
    // A failed role query must never be converted into an empty role list:
    // that would silently strip the user's permissions.
    console.error('Auth context error: role query failed', roleError.message);
    throw new Error(`Auth context error: failed to load roles (${roleError.message})`);
  }

  const roles = (userRoles ?? [])
    .map((row) => row.roles?.role_name)
    .filter((roleName): roleName is RoleName => Boolean(roleName && isRoleName(roleName)));

  return {
    userId: userData.user.id,
    organisationId,
    email: (profile?.email as string | undefined) ?? userData.user.email ?? '',
    fullName: (profile?.full_name as string | null | undefined) ?? null,
    roles
  };
}

export async function requireUserContext(): Promise<UserContext> {
  const user = await getAuthenticatedUser();
  if (!user) redirect('/login');

  const context = await getCurrentUserContext();
  if (!context) redirect('/onboarding');
  return context;
}
