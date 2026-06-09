'use server';

import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '../../lib/auth/session';
import { bootstrapFirstOrganisation } from '../../lib/repositories/onboarding';

export async function bootstrapOrganisationAction(formData: FormData) {
  const user = await requireAuthenticatedUser();
  await bootstrapFirstOrganisation(user, {
    organisationName: String(formData.get('organisation_name') ?? ''),
    industry: String(formData.get('industry') ?? ''),
    country: String(formData.get('country') ?? '')
  });
  redirect('/workspace');
}
