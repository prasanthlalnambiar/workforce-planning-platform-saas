import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';

export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Layer 2 placeholder" title="Driver Layer" phase="Phase 5" body="Future structured growth, efficiency, cost, supply and management adjustment register. Not built in Phase 1." />
    </AppShell>
  );
}
