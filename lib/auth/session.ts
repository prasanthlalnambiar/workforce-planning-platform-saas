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

export async function getCurrentUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,email,full_name,default_organisation_id')
    .eq('id', userData.user.id)
    .single();

  const { data: memberships } = await supabase
    .from('organisation_memberships')
    .select('organisation_id, organisations(name)')
    .eq('user_id', userData.user.id)
    .eq('status', 'active')
    .limit(1) as { data: MembershipRow[] | null };

  const organisationId = (profile?.default_organisation_id as string | undefined) || memberships?.[0]?.organisation_id;
  if (!organisationId) return null;

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('roles(role_name)')
    .eq('user_id', userData.user.id)
    .eq('organisation_id', organisationId) as { data: RoleRow[] | null };

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
  const context = await getCurrentUserContext();
  if (!context) redirect('/login');
  return context;
}
