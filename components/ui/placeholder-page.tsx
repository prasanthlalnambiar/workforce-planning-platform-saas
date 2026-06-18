import { Badge } from './badge';
import { PageHeader } from './page-header';

export function PlaceholderPage({ eyebrow, title, badge, body }: { eyebrow: string; title: string; badge?: string; body: string }) {
  return (
    <div className="stack">
      <PageHeader eyebrow={eyebrow} title={title} badge={badge ?? 'Not yet available'}>{body}</PageHeader>
      <section className="card placeholder">
        <h2>Not yet available</h2>
        <p>This screen is visible to preserve the full product architecture, but the module is intentionally not implemented yet.</p>
        <ul>
          <li>No calculation logic has been added here.</li>
          <li>No AI has been added here.</li>
          <li>No official forecast, actuals, variance or waterfall data is created here.</li>
        </ul>
        <Badge tone="warm">Placeholder only</Badge>
      </section>
    </div>
  );
}
