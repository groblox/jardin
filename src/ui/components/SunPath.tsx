import { useState } from 'react';
import { DEG } from '../../core/util.ts';
import { fmtTime } from '../format.ts';

export interface PathLine {
  id: string;
  label: string;
  color: string;
  points: { az: number; el: number; t: number }[];
}

interface Props {
  horizon: { az: number; horizon: number; tau: number }[];
  paths: PathLine[];
  now?: { az: number; el: number } | null;
  size?: number;
  timeZone?: string;
}

/** Polar sun-path diagram (zenith at centre, north up) with the obstruction skyline from a point. */
export function SunPath({ horizon, paths, now, size = 300, timeZone }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const c = size / 2;
  const R = size / 2 - 22;
  const pt = (az: number, el: number): [number, number] => {
    const r = (R * (90 - Math.max(0, el))) / 90;
    return [c + r * Math.sin(az * DEG), c - r * Math.cos(az * DEG)];
  };
  // Skyline polygon: from the horizon ring inward to the obstruction elevation.
  const outer = horizon.map((h) => pt(h.az, 0));
  const inner = horizon.map((h) => pt(h.az, h.horizon));
  const skyline =
    'M' + inner.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L') + 'Z ' +
    'M' + outer.map((p) => p.map((v) => v.toFixed(1)).join(',')).reverse().join('L') + 'Z';

  return (
    <figure className="chart sunpath">
      <div className="legend" aria-hidden="true">
        {paths.map((p) => (
          <span key={p.id} className="legend-item">
            <span className="legend-swatch line" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--obstruction)' }} />
          Obstructions
        </span>
      </div>
      <div className="chart-box" style={{ maxWidth: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Sun path diagram with obstruction skyline" onPointerLeave={() => setHover(null)}>
          {[0, 30, 60].map((el) => (
            <circle key={el} cx={c} cy={c} r={(R * (90 - el)) / 90} className="grid" fill="none" />
          ))}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((az) => {
            const [x, y] = pt(az, 0);
            return <line key={az} x1={c} y1={c} x2={x} y2={y} className="grid" />;
          })}
          <path d={skyline} fillRule="evenodd" fill="var(--obstruction)" opacity={0.85} />
          {(['N', 'E', 'S', 'W'] as const).map((l, i) => {
            const rr = R + 12;
            return (
              <text key={l} x={c + rr * Math.sin(i * 90 * DEG)} y={c - rr * Math.cos(i * 90 * DEG) + 4} textAnchor="middle" className="axis-label strong">
                {l}
              </text>
            );
          })}
          {[30, 60].map((el) => (
            <text key={el} x={c + 3} y={c - (R * (90 - el)) / 90 - 3} className="axis-label">{el}°</text>
          ))}
          {paths.map((p) => {
            const vis = p.points.filter((q) => q.el > 0);
            if (!vis.length) return null;
            const d = 'M' + vis.map((q) => pt(q.az, q.el).map((v) => v.toFixed(1)).join(',')).join('L');
            return (
              <g key={p.id}>
                <path d={d} fill="none" stroke={p.color} strokeWidth={2} strokeLinecap="round" />
                {vis.filter((_, i) => i % 6 === 0).map((q, i) => {
                  const [x, y] = pt(q.az, q.el);
                  return (
                    <circle key={i} cx={x} cy={y} r={7} fill="transparent"
                      onPointerEnter={() => setHover({ x, y, text: `${p.label}: ${fmtTime(q.t, timeZone)} · ${q.el.toFixed(0)}° high, ${q.az.toFixed(0)}° az` })} />
                  );
                })}
              </g>
            );
          })}
          {now && now.el > 0 && <circle cx={pt(now.az, now.el)[0]} cy={pt(now.az, now.el)[1]} r={6} fill="var(--sun)" className="marker-ring" />}
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: `${(hover.x / size) * 100}%`, top: `${(hover.y / size) * 100}%`, transform: 'translate(-50%, calc(-100% - 10px))' }}>
            {hover.text}
          </div>
        )}
      </div>
    </figure>
  );
}
