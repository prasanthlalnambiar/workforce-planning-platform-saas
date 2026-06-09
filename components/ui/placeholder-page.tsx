import { Badge } from './badge';
import { PageHeader } from './page-header';

export function PlaceholderPage({ eyebrow, title, phase, body }: { eyebrow: string; title: string; phase: string; body: string }) {
  return (
    <div className="stack">
      <PageHeader eyebrow={eyebrow} title={title} badge={phase}>{body}</PageHeader>
      <section className="card placeholder">
        <h2>Phase 1 guardrail</h2>
        <p>This screen is visible to preserve the full product architecture, but the module is intentionally not implemented yet.</p>
        <ul>
          <li>No calculation logic has been added here.</li>
          <li>No AI has been added here.</li>
          <li>No official forecast, actuals, variance or waterfall data is created in Phase 1.</li>
        </ul>
        <Badge tone="warm">Placeholder only</Badge>
      </section>
    </div>
  );
}
