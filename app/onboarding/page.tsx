import { redirect } from 'next/navigation';
import { bootstrapOrganisationAction } from './actions';
import { getCurrentUserContext, requireAuthenticatedUser } from '../../lib/auth/session';


export const dynamic = 'force-dynamic';
export default async function OnboardingPage() {
  const user = await requireAuthenticatedUser();
  const context = await getCurrentUserContext();
  if (context) redirect('/workspace');

  return (
    <main className="login-shell">
      <section className="card login-card">
        <p className="eyebrow">First workspace</p>
        <h1>Create your organisation</h1>
        <p className="lede">
          You are signed in as {user.email}. Create the first tenant workspace for this product. You will be assigned the owner role automatically.
        </p>
        <form className="stack" action={bootstrapOrganisationAction}>
          <label className="field">
            <span>Organisation name</span>
            <input name="organisation_name" required placeholder="Example Operations Planning" />
          </label>
          <label className="field">
            <span>Industry</span>
            <input name="industry" placeholder="Banking, government, insurance, technology..." />
          </label>
          <label className="field">
            <span>Country</span>
            <input name="country" defaultValue="Australia" />
          </label>
          <button className="button" type="submit">Create organisation</button>
        </form>
        <p className="small-note">
          Onboarding creates only the tenant, roles, membership and audit event. Planning views become available as you add data.
        </p>
      </section>
    </main>
  );
}
