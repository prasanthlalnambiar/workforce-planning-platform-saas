import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';


export const dynamic = 'force-dynamic';
export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Future module placeholder" title="Waterfall Reporting" phase="Phase 8" body="Future deterministic baseline-to-forecast and forecast-to-actuals bridge reporting." />
    </AppShell>
  );
}
