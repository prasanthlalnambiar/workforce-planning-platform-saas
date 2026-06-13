import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';


export const dynamic = 'force-dynamic';
export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Future module placeholder" title="AI Advisory" phase="Phase 9" body="Future backend-only AI advisory. AI will never calculate official FTE, cost, budget or variance values." />
    </AppShell>
  );
}
