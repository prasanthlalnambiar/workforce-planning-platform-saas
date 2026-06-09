import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';

export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Layer 2 placeholder" title="Budget Baseline" phase="Phase 4" body="Future module for annual OPEX baseline creation and immutable lock. Not built in Phase 1." />
    </AppShell>
  );
}
