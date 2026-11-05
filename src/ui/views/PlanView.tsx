import { useMemo, useState } from 'react';
import { useElementWidth } from '../hooks.ts';
import { useGarden } from '../store.tsx';
import { gardenTasks, plantNow, planningYear, plantTimeline, seasonFor, type Task } from '../../core/schedule.ts';
import { simulateGrowth } from '../../core/growth.ts';
import { PLANT_BY_ID } from '../../core/plants.ts';
import { addDays, fmtDate, isoDate, parseIso } from '../../core/util.ts';
import { Meter } from '../components/Chart.tsx';
import { Status } from '../components/Field.tsx';

const KIND_LABEL: Record<Task['kind'], string> = {
  'start-indoors': 'Start indoors', 'harden-off': 'Harden off', transplant: 'Transplant', 'direct-sow': 'Sow',
  succession: 'Succession', harvest: 'Harvest', 'fall-sow': 'Fall planting',
};

export function PlanView() {
  const { garden, weather, update } = useGarden();
  const today = new Date();
  const [year, setYear] = useState(() => planningYear(garden.site, today));
  const season = seasonFor(garden.site, year);
  const tasks = useMemo(() => gardenTasks(garden, year), [garden, year]);
  const now = useMemo(() => plantNow(garden.site, today), [garden.site]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayIso = isoDate(today);

  const growing = useMemo(() => {
    const out: { bedName: string; bedId: string; r: NonNullable<ReturnType<typeof simulateGrowth>> }[] = [];
    for (const bed of garden.beds)
      for (const pl of bed.plantings) {
        if (!pl.plantedOn) continue;
        const r = simulateGrowth(pl, weather?.daily ?? [], { today: weather?.today ?? todayIso, sunHours: bed.analysis?.sunHours });
        if (r && r.stage !== 'done') out.push({ bedName: bed.name, bedId: bed.id, r });
      }
    return out;
  }, [garden.beds, weather, todayIso]);

  const upcoming = tasks.filter((t) => (t.endDate ?? t.date) >= todayIso);
  const byMonth = new Map<string, Task[]>();
  for (const t of upcoming) {
    const k = t.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(t);
  }

  const markPlanted = (t: Task) => {
    if (!t.bedId || !t.plantId) return;
    update((g) => ({
      ...g,
      beds: g.beds.map((b) => (b.id !== t.bedId ? b : { ...b, plantings: b.plantings.map((p) => (p.plantId === t.plantId && !p.plantedOn ? { ...p, plantedOn: todayIso } : p)) })),
    }));
  };

  return (
    <div className="view plan-view">
      <div className="row between wrap gap">
        <div className="row gap">
          <button onClick={() => setYear(year - 1)} aria-label="Previous season">‹</button>
          <h2>{year} season</h2>
          <button onClick={() => setYear(year + 1)} aria-label="Next season">›</button>
        </div>
        <div className="muted">
          Last frost <b>{fmtDate(season.lastFrost)}</b> · first frost <b>{fmtDate(season.firstFrost)}</b> · {season.frostFreeDays} frost-free days
        </div>
      </div>

      <div className="plan-layout">
        <div>
          <section className="card">
            <h3>Timeline</h3>
            <Gantt year={year} />
          </section>

          {growing.length > 0 && (
            <section className="card">
              <h3>Growing now</h3>
              <p className="muted small">Development is simulated from actual & forecast temperatures and each bed’s sunlight, so harvest dates move with the weather.</p>
              <table className="table">
                <thead><tr><th>Crop</th><th>Bed</th><th>Planted</th><th>Progress</th><th>Ready</th><th>Alerts</th></tr></thead>
                <tbody>
                  {growing.map(({ bedName, r }) => (
                    <tr key={r.planting.id}>
                      <td><span aria-hidden="true">{r.plant.icon}</span> {r.plant.name}</td>
                      <td>{bedName}</td>
                      <td className="tabular">{fmtDate(r.planting.plantedOn!)}</td>
                      <td style={{ minWidth: 110 }}>
                        <Meter value={Math.min(1, r.progress)} tone={r.progress >= 1 ? 'good' : 'accent'} label={`${r.plant.name} progress`} />
                        <span className="small muted">{r.stage} · {Math.round(r.progress * 100)}%</span>
                      </td>
                      <td className="tabular">{r.maturityDate ? fmtDate(r.maturityDate) : '—'}{r.harvestEndDate ? ` – ${fmtDate(r.harvestEndDate)}` : ''}</td>
                      <td>{r.warnings.slice(0, 2).map((w, i) => <div key={i}><Status tone={w.level === 'bad' ? 'critical' : 'warning'}>{fmtDate(w.date)}: {w.kind}</Status></div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="card">
            <h3>Upcoming tasks</h3>
            {upcoming.length === 0 && <p className="muted">Nothing scheduled — add plants to a bed to generate tasks.</p>}
            {[...byMonth].map(([month, list]) => (
              <div key={month} className="task-month">
                <h4>{parseIso(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h4>
                <ul className="tasks">
                  {list.map((t, i) => {
                    const overdue = t.date < todayIso && t.kind !== 'harvest';
                    const active = t.date <= todayIso && (t.endDate ?? t.date) >= todayIso;
                    return (
                      <li key={i} className={active ? 'active' : ''}>
                        <span className={`task-kind k-${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                        <span className="grow"><span aria-hidden="true">{PLANT_BY_ID[t.plantId]?.icon}</span> {t.title}</span>
                        <span className="tabular muted">{fmtDate(t.date)}{t.endDate ? ` – ${fmtDate(t.endDate)}` : ''}</span>
                        {overdue && <Status tone="warning">due</Status>}
                        {(t.kind === 'transplant' || t.kind === 'direct-sow' || t.kind === 'fall-sow') && t.date <= isoDate(addDays(today, 7)) && (
                          <button className="small" onClick={() => markPlanted(t)}>Done</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <aside className="side-col">
          <section className="card">
            <h3>Plant now</h3>
            <p className="muted small">Windows open today ({fmtDate(today)}) for your frost dates.</p>
            {now.length === 0 && <p className="muted">Nothing is in its window right now — a good time to plan, order seeds and add compost.</p>}
            <ul className="plant-now">
              {now.map((x) => (
                <li key={x.plant.id + x.action}>
                  <span aria-hidden="true">{x.plant.icon}</span> <b>{x.plant.name}</b>
                  <span className="muted small"> — {x.action.replace('-', ' ')} until {fmtDate(x.until)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Gantt({ year }: { year: number }) {
  const { garden } = useGarden();
  const season = seasonFor(garden.site, year);
  const plantIds = [...new Set(garden.beds.flatMap((b) => b.plantings.map((p) => p.plantId)))];
  const start = addDays(season.lastFrost, -84);
  const end = addDays(season.firstFrost, 30);
  const span = end.getTime() - start.getTime();
  const [boxRef, boxW] = useElementWidth<HTMLDivElement>();
  const W = Math.max(360, boxW || 640);
  const L = 130;
  const rowH = 26;
  const H = 28 + plantIds.length * rowH + 8;
  const x = (d: Date) => L + ((d.getTime() - start.getTime()) / span) * (W - L - 8);
  const months: Date[] = [];
  for (let d = new Date(start.getFullYear(), start.getMonth() + 1, 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  const today = new Date();

  return (
    <figure className="chart">
      <div className="legend" aria-hidden="true">
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-4)' }} />Start indoors</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-3)' }} />Sow / transplant window</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-2)' }} />Harvest</span>
      </div>
      <div className="chart-box" ref={boxRef}>
        {!plantIds.length && <p className="muted">Add plants to your beds to see their timeline.</p>}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Planting timeline">
          {months.map((m) => (
            <g key={m.toISOString()}>
              <line x1={x(m)} x2={x(m)} y1={18} y2={H - 4} className="grid" />
              <text x={x(m) + 3} y={12} className="axis-label">{m.toLocaleDateString(undefined, { month: 'short' })}</text>
            </g>
          ))}
          {[['Last frost', season.lastFrost], ['First frost', season.firstFrost]].map(([l, d]) => (
            <g key={l as string}>
              <line x1={x(d as Date)} x2={x(d as Date)} y1={18} y2={H - 4} className="ref-line" />
            </g>
          ))}
          {today > start && today < end && <line x1={x(today)} x2={x(today)} y1={18} y2={H - 4} className="today-line" />}
          {plantIds.map((id, i) => {
            const plant = PLANT_BY_ID[id];
            if (!plant) return null;
            const t = plantTimeline(plant, season);
            const y = 24 + i * rowH;
            // Sowing/starting on the upper half of the row, harvest on the lower half.
            const bar = (a: Date, b: Date, color: string, label: string, lower = false) => (
              <rect x={x(a)} y={y + (lower ? rowH / 2 : 2)} width={Math.max(4, x(b) - x(a))} height={rowH / 2 - 3} rx={3} fill={color}>
                <title>{`${plant.name} — ${label}: ${fmtDate(a)} – ${fmtDate(b)}`}</title>
              </rect>
            );
            return (
              <g key={id}>
                <text x={4} y={y + rowH / 2 + 3} className="axis-label strong">{plant.icon} {plant.name}</text>
                {t.startIndoors && t.transplant && bar(t.startIndoors, t.transplant, 'var(--series-4)', 'start indoors')}
                {t.transplant && bar(t.transplant, addDays(t.transplant, 10), 'var(--series-3)', 'transplant')}
                {t.directSow && bar(t.directSow[0], t.directSow[1], 'var(--series-3)', 'direct sow')}
                {t.fallSow && bar(t.fallSow, addDays(t.fallSow, 14), 'var(--series-3)', 'fall sow')}
                {bar(t.harvest[0], t.harvest[1], 'var(--series-2)', 'harvest', true)}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="muted small">Dashed lines: last & first frost. Solid line: today.</figcaption>
    </figure>
  );
}
