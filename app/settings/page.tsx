import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';


export const dynamic = 'force-dynamic';
export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Phase 1 placeholder" title="Settings" phase="Phase 1" body="Future tenant settings, user administration and governance controls. Basic route is reserved in Phase 1." />
    </AppShell>
  );
}
