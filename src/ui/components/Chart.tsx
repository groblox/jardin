import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useElementWidth } from '../hooks.ts';

export interface Series {
  id: string;
  label: string;
  /** CSS color, normally a var(--series-n) token. */
  color: string;
  kind: 'line' | 'bar';
  values: (number | null)[];
  /** Bars sharing a stack key are stacked. */
  stack?: string;
  dashed?: boolean;
}

export interface RefLine {
  y: number;
  label: string;
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  /** Label for the x position in the tooltip. */
  formatLabel?: (l: string, i: number) => string;
  refLines?: RefLine[];
  /** Index at which forecast begins (shaded band). */
  forecastFrom?: number;
  yMin?: number;
  yMax?: number;
  title?: ReactNode;
  ariaLabel: string;
}

const PAD = { l: 44, r: 12, t: 12, b: 26 };

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Rounded data-end at the top (away from the baseline), square at the baseline. */
function barPath(x: number, y0: number, y1: number, w: number, r = 4): string {
  const top = Math.min(y0, y1);
  const bot = Math.max(y0, y1);
  const h = bot - top;
  if (h < 0.5) return '';
  const rr = Math.min(r, w / 2, h);
  const up = y1 < y0; // value above baseline → round the top
  if (up)
    return `M${x},${bot}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${bot}Z`;
  return `M${x},${top}V${bot - rr}Q${x},${bot} ${x + rr},${bot}H${x + w - rr}Q${x + w},${bot} ${x + w},${bot - rr}V${top}Z`;
}

export function Chart({ labels, series, height = 200, format = (v) => v.toFixed(1), formatLabel = (l) => l, refLines = [], forecastFrom, yMin, yMax, title, ariaLabel }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, boxW] = useElementWidth<HTMLDivElement>();
  const W = Math.max(280, boxW || 640);
  const H = height;
  const n = labels.length;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const { lo, hi } = useMemo(() => {
    let lo = yMin ?? Infinity;
    let hi = yMax ?? -Infinity;
    const stacks = new Map<string, { pos: number[]; neg: number[] }>();
    for (const s of series) {
      if (s.kind === 'bar' && s.stack) {
        const st = stacks.get(s.stack) ?? { pos: new Array(n).fill(0), neg: new Array(n).fill(0) };
        s.values.forEach((v, i) => {
          if (v == null) return;
          if (v >= 0) st.pos[i] += v;
          else st.neg[i] += v;
        });
        stacks.set(s.stack, st);
      }
      for (const v of s.values) {
        if (v == null) continue;
        if (yMin == null) lo = Math.min(lo, v);
        if (yMax == null) hi = Math.max(hi, v);
      }
    }
    for (const st of stacks.values()) {
      if (yMax == null) hi = Math.max(hi, ...st.pos);
      if (yMin == null) lo = Math.min(lo, ...st.neg);
    }
    for (const r of refLines) {
      if (yMax == null) hi = Math.max(hi, r.y);
      if (yMin == null) lo = Math.min(lo, r.y);
    }
    if (series.some((s) => s.kind === 'bar')) lo = Math.min(lo, 0);
    if (!Number.isFinite(lo)) lo = 0;
    if (!Number.isFinite(hi)) hi = 1;
    if (hi === lo) hi = lo + 1;
    return { lo, hi: yMax ?? hi + (hi - lo) * 0.05 };
  }, [series, n, yMin, yMax, refLines]);

  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i + 0.5) * (iw / n));
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks = niceTicks(lo, hi);
  const bandW = iw / Math.max(1, n);

  const barSeries = series.filter((s) => s.kind === 'bar');
  const groups = [...new Set(barSeries.map((s) => s.stack ?? s.id))];
  const gap = 2;
  const groupW = Math.max(1, Math.min(28, bandW * 0.72));
  const barW = Math.max(1, (groupW - gap * (groups.length - 1)) / Math.max(1, groups.length));

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 70))));

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - PAD.l) / bandW);
    setHover(i >= 0 && i < n ? i : null);
  };

  const stackOffsets = new Map<string, { pos: number[]; neg: number[] }>();

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      {series.length > 1 && (
        <div className="legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.id} className="legend-item">
              <span className={`legend-swatch ${s.kind}`} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-box" ref={boxRef}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {forecastFrom != null && forecastFrom < n && (
            <g>
              <rect x={PAD.l + forecastFrom * bandW} y={PAD.t} width={(n - forecastFrom) * bandW} height={ih} className="forecast-band" />
              <text x={PAD.l + forecastFrom * bandW + 4} y={PAD.t + 11} className="axis-label">Forecast</text>
            </g>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="axis-label tabular">{format(t)}</text>
            </g>
          ))}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(Math.max(lo, 0))} y2={y(Math.max(lo, 0))} className="baseline" />
          {labels.map((l, i) => (i % labelEvery === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="axis-label">{l}</text> : null))}

          {barSeries.map((s) => {
            const gi = groups.indexOf(s.stack ?? s.id);
            if (s.stack && !stackOffsets.has(s.stack)) stackOffsets.set(s.stack, { pos: new Array(n).fill(0), neg: new Array(n).fill(0) });
            const off = s.stack ? stackOffsets.get(s.stack)! : null;
            return (
              <g key={s.id} fill={s.color}>
                {s.values.map((v, i) => {
                  if (v == null || v === 0) return null;
                  const bx = x(i) - groupW / 2 + gi * (barW + gap);
                  let b0 = 0;
                  if (off) {
                    b0 = v >= 0 ? off.pos[i] : off.neg[i];
                    if (v >= 0) off.pos[i] += v;
                    else off.neg[i] += v;
                  }
                  // 2px surface gap between stacked segments.
                  const y0 = y(b0) + (off && b0 !== 0 ? (v >= 0 ? -1 : 1) : 0);
                  const y1 = y(b0 + v) + (off && b0 !== 0 ? (v >= 0 ? 1 : -1) : 0);
                  return <path key={i} d={barPath(bx, y0, y1, barW)} />;
                })}
              </g>
            );
          })}

          {refLines.map((r) => (
            <g key={r.label}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(r.y)} y2={y(r.y)} className="ref-line" />
              <text x={W - PAD.r - 4} y={y(r.y) - 4} textAnchor="end" className="axis-label">{r.label}</text>
            </g>
          ))}

          {series.filter((s) => s.kind === 'line').map((s) => {
            let d = '';
            s.values.forEach((v, i) => {
              if (v == null) return;
              d += `${d && s.values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
            });
            return <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />;
          })}

          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="crosshair" />
              {series.filter((s) => s.kind === 'line').map((s) =>
                s.values[hover] != null ? <circle key={s.id} cx={x(hover)} cy={y(s.values[hover]!)} r={4.5} fill={s.color} className="marker-ring" /> : null,
              )}
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent" />
        </svg>
        {hover != null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
            <div className="tooltip-title">{formatLabel(labels[hover], hover)}</div>
            {series.map((s) =>
              s.values[hover] != null ? (
                <div key={s.id} className="tooltip-row">
                  <span className="legend-swatch line" style={{ background: s.color }} />
                  <span>{s.label}</span>
                  <b className="tabular">{format(s.values[hover]!)}</b>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

export function Meter({ value, max = 1, label, tone = 'accent' }: { value: number; max?: number; label?: string; tone?: 'accent' | 'good' | 'warning' | 'critical' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={`meter-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
