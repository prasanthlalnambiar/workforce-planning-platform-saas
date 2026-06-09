import 'server-only';
import { insertAuditEvent } from '../audit/audit-service';
import { roleDefinitions } from '../permissions/roles';
import { createAdminClient } from '../supabase/admin';
import type { AuthenticatedUser } from '../auth/session';
import type { RoleName } from '../../types/roles';

interface BootstrapOrganisationInput {
  organisationName: string;
  industry?: string | null;
  country?: string | null;
}

interface RoleRow {
  id: string;
  role_name: RoleName;
}

export async function bootstrapFirstOrganisation(user: AuthenticatedUser, input: BootstrapOrganisationInput) {
  const organisationName = input.organisationName.trim();
  if (!organisationName) throw new Error('Organisation name is required');

  const supabase = createAdminClient();

  const { data: existingMemberships, error: existingMembershipError } = await supabase
    .from('organisation_memberships')
    .select('id, organisation_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1);
  if (existingMembershipError) throw existingMembershipError;
  if ((existingMemberships ?? []).length > 0) {
    throw new Error('User already belongs to an organisation');
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    status: 'active'
  });
  if (profileError) throw profileError;

  const { data: organisation, error: organisationError } = await supabase
    .from('organisations')
    .insert({
      name: organisationName,
      industry: input.industry?.trim() || null,
      country: input.country?.trim() || 'Australia',
      default_currency: 'AUD',
      fiscal_year_start_month: 7,
      timezone: 'Australia/Melbourne',
      status: 'active'
    })
    .select('id, name')
    .single();
  if (organisationError) throw organisationError;

  const organisationId = organisation.id as string;
  const rolePayload = roleDefinitions.map((role) => ({
    organisation_id: organisationId,
    role_name: role.name,
    description: role.description
  }));

  const { data: roles, error: rolesError } = await supabase
    .from('roles')
    .insert(rolePayload)
    .select('id, role_name') as { data: RoleRow[] | null; error: Error | null };
  if (rolesError) throw rolesError;

  const ownerRole = roles?.find((role) => role.role_name === 'owner');
  if (!ownerRole) throw new Error('Owner role was not created');

  const { error: membershipError } = await supabase.from('organisation_memberships').insert({
    organisation_id: organisationId,
    user_id: user.id,
    status: 'active'
  });
  if (membershipError) throw membershipError;

  const { error: userRoleError } = await supabase.from('user_roles').insert({
    organisation_id: organisationId,
    user_id: user.id,
    role_id: ownerRole.id
  });
  if (userRoleError) throw userRoleError;

  const { error: defaultOrgError } = await supabase
    .from('profiles')
    .update({ default_organisation_id: organisationId })
    .eq('id', user.id);
  if (defaultOrgError) throw defaultOrgError;

  await insertAuditEvent({
    organisationId,
    actorUserId: user.id,
    eventType: 'organisation.bootstrapped',
    entityType: 'organisation',
    entityId: organisationId,
    newValue: {
      organisation_name: organisationName,
      roles_created: rolePayload.map((role) => role.role_name),
      initial_owner_user_id: user.id
    },
    reason: 'First organisation created during Phase 1 onboarding'
  });

  return { organisationId };
}
