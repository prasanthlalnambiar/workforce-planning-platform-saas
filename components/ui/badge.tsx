export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'warm' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
