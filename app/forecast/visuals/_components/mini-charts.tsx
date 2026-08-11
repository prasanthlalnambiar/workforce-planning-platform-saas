// Minimal read-only SVG charts — no external chart dependency. They render only
// the deterministic series passed in; with no data they render an empty state.

export interface Series {
  name: string;
  color: string;
  values: number[];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

export function LineChart({
  labels,
  series,
  height = 200,
  format = (n: number) => String(Math.round(n))
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
}) {
  const width = 640;
  const padL = 56;
  const padR = 16;
  const padT = 12;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const maxVal = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / maxVal) * innerH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" width="100%" style={{ maxWidth: width }}>
      {/* y grid */}
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={padL} x2={width - padR} y1={padT + innerH * (1 - t)} y2={padT + innerH * (1 - t)} stroke="currentColor" strokeOpacity="0.12" />
          <text x={padL - 8} y={padT + innerH * (1 - t) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.6">{format(maxVal * t)}</text>
        </g>
      ))}
      {/* series */}
      {series.map((s) => (
        <g key={s.name}>
          <polyline
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={s.color} />)}
        </g>
      ))}
      {/* x labels (first, mid, last to avoid crowding) */}
      {labels.map((l, i) => {
        if (n > 3 && i !== 0 && i !== n - 1 && i !== Math.floor((n - 1) / 2)) return null;
        return <text key={i} x={x(i)} y={height - 12} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">{l}</text>;
      })}
    </svg>
  );
}

export function GroupedBarChart({
  labels,
  series,
  height = 200,
  format = (n: number) => String(Math.round(n))
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
}) {
  const width = 640;
  const padL = 56;
  const padR = 16;
  const padT = 12;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const maxVal = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const groupW = innerW / Math.max(1, n);
  const barW = Math.min(26, (groupW * 0.7) / Math.max(1, series.length));
  const y = (v: number) => padT + innerH - (v / maxVal) * innerH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" width="100%" style={{ maxWidth: width }}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={padL} x2={width - padR} y1={padT + innerH * (1 - t)} y2={padT + innerH * (1 - t)} stroke="currentColor" strokeOpacity="0.12" />
          <text x={padL - 8} y={padT + innerH * (1 - t) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.6">{format(maxVal * t)}</text>
        </g>
      ))}
      {labels.map((l, i) => {
        const gx = padL + i * groupW + groupW / 2;
        return (
          <g key={i}>
            {series.map((s, si) => {
              const bx = gx - (series.length * barW) / 2 + si * barW;
              const v = s.values[i] ?? 0;
              return <rect key={s.name} x={bx} y={y(v)} width={barW - 2} height={padT + innerH - y(v)} fill={s.color} rx="2" />;
            })}
            <text x={gx} y={height - 12} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">{l}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <div className="split-row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
      {series.map((s) => (
        <span key={s.name} className="small-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: 'inline-block' }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}
