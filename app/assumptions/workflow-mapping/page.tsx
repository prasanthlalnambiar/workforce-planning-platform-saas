import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { Layer1Subnav } from '../../layer1/_components/layer1-shared';

export const dynamic = 'force-dynamic';

export default async function WorkflowMappingPage() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Assumptions" title="Workflow Mapping" badge="Later step">
          Map each workflow to a knowledge group (for example, Support Voice and Support Webchat
          into a Customer Support group).
        </PageHeader>
        <Layer1Subnav tab="Assumptions" />
        <section className="card">
          <p className="eyebrow">Coming in a later planning step</p>
          <p className="small-note">
            Workflow-to-knowledge-group mapping is part of the workforce-structure work that comes
            after the flexible-input foundation. It is not available yet, and nothing here changes
            any calculation. This tab is a placeholder so the planner journey is visible end to end.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
