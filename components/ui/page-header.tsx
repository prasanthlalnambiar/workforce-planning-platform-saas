import { Badge } from './badge';

export function PageHeader({ eyebrow, title, children, badge }: { eyebrow: string; title: string; children: React.ReactNode; badge?: string }) {
  return (
    <section className="header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{children}</p>
      </div>
      {badge ? <Badge tone="green">{badge}</Badge> : null}
    </section>
  );
}
