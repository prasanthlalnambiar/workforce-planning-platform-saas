import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { Layer1Subnav } from '../../layer1/_components/layer1-shared';

export const dynamic = 'force-dynamic';

export default async function LocationVendorSplitPage() {
  const context = await requireUserContext();
  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Assumptions" title="Location & Vendor Split" badge="Later step">
          Split each knowledge group across locations and vendors (for example, 60% Melbourne
          internal, 25% Manila vendor, 15% Dublin internal).
        </PageHeader>
        <Layer1Subnav tab="Assumptions" />
        <section className="card">
          <p className="eyebrow">Coming in a later planning step</p>
          <p className="small-note">
            Knowledge-group-to-location/vendor split is part of the workforce-structure work that
            comes after the flexible-input foundation. It is not available yet, and nothing here
            changes any calculation. This tab is a placeholder so the planner journey is visible end
            to end.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
