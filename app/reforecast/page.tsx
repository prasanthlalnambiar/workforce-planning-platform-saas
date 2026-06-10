import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';


export const dynamic = 'force-dynamic';
export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Layer 2 placeholder" title="Monthly Reforecast" phase="Phase 6" body="Future working forecast, historical locks and latest valid forecast. Not built in Phase 1." />
    </AppShell>
  );
}
