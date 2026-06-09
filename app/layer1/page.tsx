import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';

export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Layer 1 placeholder" title="Layer 1 Demand Engine" phase="Phase 2/3" body="Future module for messy demand, hidden work, workload, FTE, supply gap, labour budget, approval and locked handoff. Not built in Phase 1." />
    </AppShell>
  );
}
