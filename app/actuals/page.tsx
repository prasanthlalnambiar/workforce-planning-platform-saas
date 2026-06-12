import { AppShell } from '../../components/app-shell/app-shell';
import { PlaceholderPage } from '../../components/ui/placeholder-page';
import { requireUserContext } from '../../lib/auth/session';


export const dynamic = 'force-dynamic';
export default async function Page() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <PlaceholderPage eyebrow="Future module placeholder" title="Actuals Ingestion" phase="Phase 7" body="Future upload, staging, validation and approval. Actuals will never overwrite forecast values." />
    </AppShell>
  );
}
