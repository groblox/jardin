import { useMemo, useState } from 'react';
import { useElementWidth } from '../hooks.ts';
import { useGarden } from '../store.tsx';
import { plantNow, planningYear, seasonFor } from '../../core/schedule.ts';
import { gardenTasks, TASK_LABEL, type Task } from '../../core/tasks.ts';
import { plantingInterval, plantingWindows } from '../../core/succession.ts';
import { simulateGrowth } from '../../core/growth.ts';
import { seasonYields } from '../../core/journal.ts';
import { PLANT_BY_ID } from '../../core/plants.ts';
import type { JournalEntry } from '../../core/types.ts';
import { addDays, fmtDate, isoDate, parseIso, uid } from '../../core/util.ts';
import { Meter } from '../components/Chart.tsx';
import { Status } from '../components/Field.tsx';
import { SeedsPanel } from './SeedsPanel.tsx';

export function PlanView() {
  const { garden, weather, update } = useGarden();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(() => planningYear(garden.site, today));
  const [showDone, setShowDone] = useState(false);
  const season = seasonFor(garden.site, year);
  const tasks = useMemo(() => gardenTasks(garden, year), [garden, year]);
  const now = useMemo(() => plantNow(garden.site, today), [garden.site, today]);
  const todayIso = isoDate(today);
  const yields = useMemo(() => seasonYields(garden, year), [garden, year]);

  const growing = useMemo(() => {
    // One row per crop × bed × planting date (several squares of the same sowing are one row).
    const rows = new Map<string, { bedName: string; r: NonNullable<ReturnType<typeof simulateGrowth>>; n: number }>();
    for (const bed of garden.beds)
      for (const pl of bed.plantings) {
        if (!pl.plantedOn || pl.removedOn) continue;
        const k = `${bed.id}|${pl.plantId}|${pl.plantedOn}|${pl.method}`;
        const row = rows.get(k);
        if (row) {
          row.n++;
          continue;
        }
        const r = simulateGrowth(pl, weather?.daily ?? [], { today: weather?.today ?? todayIso, sunHours: bed.analysis?.sunHours });
        if (r && r.stage !== 'done') rows.set(k, { bedName: bed.name, r, n: 1 });
      }
    return [...rows.values()];
  }, [garden.beds, weather, todayIso]);

  const visible = tasks.filter((t) => (showDone || !t.done) && ((t.endDate ?? t.date) >= todayIso || !t.done));
  const byMonth = new Map<string, Task[]>();
  for (const t of visible) {
    const k = t.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(t);
  }

  const complete = (t: Task) => {
    if (t.kind === 'transplant' || t.kind === 'direct-sow') {
      update((g) => ({ ...g, beds: g.beds.map((b) => ({ ...b, plantings: b.plantings.map((p) => (t.plantingIds.includes(p.id) && !p.plantedOn ? { ...p, plantedOn: todayIso } : p)) })) }));
    } else if (t.kind === 'side-dress' || t.kind === 'prep') {
      const e: JournalEntry = { id: uid('j'), date: todayIso, kind: t.kind === 'prep' ? 'amend' : 'fertilize', bedId: t.bedId, plantId: t.plantId, text: t.title };
      update((g) => ({ ...g, journal: [...g.journal, e] }));
    }
  };
  const journalDone = (t: Task) => garden.journal.some((e) => e.text === t.title && e.date >= addIso(t.date, -14));

  return (
    <div className="view plan-view">
      <div className="row between wrap gap">
        <div className="row gap">
          <button onClick={() => setYear(year - 1)} aria-label="Previous season">‹</button>
          <h2>{year} season</h2>
          <button onClick={() => setYear(year + 1)} aria-label="Next season">›</button>
        </div>
        <div className="row gap wrap">
          <span className="muted">Last frost <b>{fmtDate(season.lastFrost)}</b> · first frost <b>{fmtDate(season.firstFrost)}</b> · {season.frostFreeDays} frost-free days</span>
          <button className="small no-print" onClick={() => window.print()} title="Print the timeline, seed list and tasks">Print plan</button>
        </div>
      </div>

      <div className="plan-layout">
        <div>
          <section className="card">
            <h3>Timeline</h3>
            <Gantt year={year} />
          </section>

          <SeedsPanel year={year} />

          {growing.length > 0 && (
            <section className="card">
              <h3>Growing now</h3>
              <p className="muted small">Development is simulated from actual & forecast temperatures and each bed’s sunlight, so harvest dates move with the weather.</p>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Crop</th><th>Bed</th><th>Planted</th><th>Progress</th><th>Ready</th><th>Alerts</th></tr></thead>
                  <tbody>
                    {growing.map(({ bedName, r, n }) => (
                      <tr key={r.planting.id}>
                        <td><span aria-hidden="true">{r.plant.icon}</span> {r.plant.name}{n > 1 ? <span className="muted"> ×{n}</span> : null}</td>
                        <td>{bedName}</td>
                        <td className="tabular">{fmtDate(r.planting.plantedOn!)}</td>
                        <td style={{ minWidth: 110 }}>
                          <Meter value={Math.min(1, r.progress)} tone={r.progress >= 1 ? 'good' : 'accent'} label={`${r.plant.name} progress`} />
                          <span className="small muted">{growthLabel(r, weather?.today ?? todayIso)}</span>
                        </td>
                        <td className="tabular">{r.plant.perennial ? 'as needed' : <>{r.maturityDate ? fmtDate(r.maturityDate) : '—'}{r.harvestEndDate ? ` – ${fmtDate(r.harvestEndDate)}` : ''}</>}</td>
                        <td>{r.warnings.slice(0, 2).map((w, i) => <div key={i}><Status tone={w.level === 'bad' ? 'critical' : 'warning'}>{fmtDate(w.date)}: {w.kind}</Status></div>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <div className="row between wrap gap">
              <h3>Tasks</h3>
              <label className="row gap small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
            </div>
            {visible.length === 0 && <p className="muted">Nothing scheduled — plan crops in your beds to generate tasks.</p>}
            {[...byMonth].map(([month, list]) => (
              <div key={month} className="task-month">
                <h4>{parseIso(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h4>
                <ul className="tasks">
                  {list.map((t, i) => {
                    const done = t.done || journalDone(t);
                    const overdue = !done && t.date < todayIso && t.kind !== 'harvest';
                    const active = t.date <= todayIso && (t.endDate ?? t.date) >= todayIso;
                    const actionable = !done && t.date <= isoDate(addDays(today, 7)) && ['transplant', 'direct-sow', 'side-dress', 'prep'].includes(t.kind);
                    return (
                      <li key={i} className={`${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                        <span className={`task-kind k-${t.kind}`}>{TASK_LABEL[t.kind]}</span>
                        <span className="grow">
                          <span aria-hidden="true">{PLANT_BY_ID[t.plantId]?.icon}</span> {t.title}{t.plantingIds.length > 1 ? <span className="muted"> · {t.plantingIds.length} squares</span> : null}
                          {t.detail && <span className="muted small block">{t.detail}</span>}
                        </span>
                        <span className="tabular muted">{fmtDate(t.date)}{t.endDate ? ` – ${fmtDate(t.endDate)}` : ''}</span>
                        {overdue && <Status tone="warning">due</Status>}
                        {done && <Status tone="good">done</Status>}
                        {actionable && <button className="small" onClick={() => complete(t)}>Done</button>}
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
          {yields.length > 0 && (
            <section className="card">
              <h3>Harvest {year}</h3>
              <p className="muted small">Expected from the plan (typical home-garden yields) vs. logged harvests.</p>
              <table className="table">
                <thead><tr><th>Crop</th><th>Sq ft</th><th>Expected</th><th>Logged</th></tr></thead>
                <tbody>
                  {yields.map((y) => (
                    <tr key={y.plantId}>
                      <td><span aria-hidden="true">{PLANT_BY_ID[y.plantId]?.icon}</span> {PLANT_BY_ID[y.plantId]?.name}</td>
                      <td className="tabular">{y.squares || '—'}</td>
                      <td className="tabular">{y.expectedLb ? `${y.expectedLb.toFixed(1)} lb` : '—'}</td>
                      <td className="tabular">{y.harvestedLb ? `${y.harvestedLb.toFixed(1)} lb` : ''}{y.harvestedCount ? ` ${y.harvestedCount} ct` : ''}{!y.harvestedLb && !y.harvestedCount ? '—' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

const addIso = (d: string, n: number) => isoDate(addDays(parseIso(d), n));

/** Plain words for where a crop is, instead of raw model stages and >100% progress. */
function growthLabel(r: NonNullable<ReturnType<typeof simulateGrowth>>, todayIso: string): string {
  if (r.plant.perennial) return r.progress >= 1 ? 'Established' : `Establishing · ${Math.round(r.progress * 100)}%`;
  if (r.progress >= 1) return r.harvestEndDate && r.harvestEndDate < todayIso ? 'Past its harvest window' : 'Harvesting';
  if (r.stage === 'initial') return `Seedling · ${Math.round(r.progress * 100)}%`;
  return `Growing · ${Math.round(r.progress * 100)}%`;
}

function Gantt({ year }: { year: number }) {
  const { garden } = useGarden();
  const site = garden.site;
  const season = seasonFor(site, year);
  const [boxRef, boxW] = useElementWidth<HTMLDivElement>();
  // One row per crop × start date (successions show as separate rows).
  const rows = new Map<string, { plantId: string; start: Date; end: Date; method: string; n: number; planted: boolean }>();
  for (const bed of garden.beds)
    for (const pl of bed.plantings) {
      if (pl.season !== year || !PLANT_BY_ID[pl.plantId]) continue;
      const iv = plantingInterval(pl, site);
      const k = `${pl.plantId}|${isoDate(iv.start)}`;
      const r = rows.get(k);
      if (r) r.n++;
      else rows.set(k, { plantId: pl.plantId, start: iv.start, end: iv.end, method: pl.method, n: 1, planted: !!pl.plantedOn });
    }
  const list = [...rows.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  const start = addDays(season.lastFrost, -84);
  const end = addDays(season.firstFrost, 45);
  const span = end.getTime() - start.getTime();
  const W = Math.max(360, boxW || 640);
  const L = 140;
  const rowH = 24;
  const H = 28 + list.length * rowH + 8;
  const x = (d: Date) => L + Math.max(0, Math.min(1, (d.getTime() - start.getTime()) / span)) * (W - L - 8);
  const months: Date[] = [];
  for (let d = new Date(start.getFullYear(), start.getMonth() + 1, 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  const today = new Date();
  return (
    <figure className="chart">
      <div className="legend" aria-hidden="true">
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-4)' }} />Seedlings indoors</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-3)' }} />In the bed</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-2)' }} />Harvest</span>
      </div>
      <div className="chart-box" ref={boxRef}>
        {!list.length && <p className="muted">Plan crops in your beds to see the season timeline.</p>}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Planting timeline">
          {months.map((m) => (
            <g key={m.toISOString()}>
              <line x1={x(m)} x2={x(m)} y1={18} y2={H - 4} className="grid" />
              <text x={x(m) + 3} y={12} className="axis-label">{m.toLocaleDateString(undefined, { month: 'short' })}</text>
            </g>
          ))}
          {[season.lastFrost, season.firstFrost].map((d) => <line key={d.toISOString()} x1={x(d)} x2={x(d)} y1={18} y2={H - 4} className="ref-line" />)}
          {today > start && today < end && <line x1={x(today)} x2={x(today)} y1={18} y2={H - 4} className="today-line" />}
          {list.map((r, i) => {
            const plant = PLANT_BY_ID[r.plantId];
            const y = 24 + i * rowH;
            const toHarvest = Math.round(plant.daysToMaturity * (r.method === 'transplant' ? 0.88 : 1));
            const h0 = addDays(r.start, toHarvest);
            const indoor = r.method === 'transplant' && plant.startIndoorsWeeks != null ? addDays(r.start, -Math.round((plant.startIndoorsWeeks + (plant.transplantWeeks ?? 0)) * 7)) : null;
            const bar = (a: Date, b: Date, color: string, label: string, dashed = false) => (
              <rect x={x(a)} y={y + 4} width={Math.max(4, x(b) - x(a))} height={rowH - 10} rx={4} fill={color} opacity={dashed ? 0.55 : 1}>
                <title>{`${plant.name} — ${label}: ${fmtDate(a)} – ${fmtDate(b)}`}</title>
              </rect>
            );
            const windows = plantingWindows(plant, r.method as 'direct' | 'transplant', season);
            return (
              <g key={i}>
                <text x={4} y={y + rowH / 2 + 3} className="axis-label strong">{plant.icon} {plant.name}{r.n > 1 ? ` ×${r.n}` : ''}</text>
                {indoor && bar(indoor, r.start, 'var(--series-4)', 'seedlings indoors')}
                {bar(r.start, h0 < r.end ? h0 : r.end, 'var(--series-3)', r.planted ? 'growing' : 'planned', !r.planted)}
                {h0 < r.end && bar(h0, r.end, 'var(--series-2)', 'harvest', !r.planted)}
                {windows.map(([a, b], wi) => <line key={wi} x1={x(a)} x2={x(b)} y1={y + rowH - 3} y2={y + rowH - 3} className="window-line"><title>Planting window {fmtDate(a)} – {fmtDate(b)}</title></line>)}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="muted small">Dashed lines: last & first frost. Solid line: today. Thin underline: the crop’s planting windows. Faded bars are planned, solid are planted.</figcaption>
    </figure>
  );
}
