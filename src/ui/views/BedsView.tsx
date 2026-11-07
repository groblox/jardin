import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Bed, BedPlanting, JournalEntry, NutrientLevel, SoilType } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { PLANTS, PLANT_BY_ID, type PlantType } from '../../core/plants.ts';
import { bedSummary, bedWarnings, plantCount, plantingsOutside } from '../../core/bed.ts';
import { followOns, occupancyAt, plantingInterval, scheduleSlot, squareHistory, cellsOf, nextSuccession } from '../../core/succession.ts';
import { planningYear, plantNow, seasonFor } from '../../core/schedule.ts';
import { compostNeeded, soilAdvice } from '../../core/soil.ts';
import { sampleMap } from '../../core/placement.ts';
import { SOILS, stageAt } from '../../core/water.ts';
import { newBed } from '../../core/defaults.ts';
import { addDays, isoDate, uid, fmtDate, parseIso } from '../../core/util.ts';
import { rampCss, SUN_SCALE_MAX } from '../sunColors.ts';
import { useElementWidth } from '../hooks.ts';
import { Field, NumberInput, Status } from '../components/Field.tsx';
import { Meter } from '../components/Chart.tsx';

type Brush = { kind: 'plant'; plant: PlantType } | { kind: 'erase' } | null;
type PaletteFilter = 'all' | 'now' | 'sun' | 'cool' | 'warm';
const FILTERS: { id: PaletteFilter; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Every crop' },
  { id: 'now', label: 'Plant now', title: 'In a sowing or planting window today' },
  { id: 'sun', label: 'Fits sun', title: 'Gets enough sun in this bed' },
  { id: 'cool', label: 'Cool', title: 'Cool-season crops' },
  { id: 'warm', label: 'Warm', title: 'Warm-season crops' },
];
const cellsOfSpan = (c: number, r: number, span: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) out.push([c + dc, r + dr]);
  return out;
};
type Sel = { kind: 'square'; col: number; row: number; plantingId?: string } | null;

const DAY = 86400000;

export function BedsView() {
  const { garden, update, selectedBedId, setSelectedBedId, sun, setTab } = useGarden();
  const site = garden.site;
  const today = useMemo(() => new Date(), []);
  const bed = garden.beds.find((b) => b.id === selectedBedId) ?? garden.beds[0];
  const [season, setSeason] = useState(() => planningYear(site, today));
  const s = seasonFor(site, season);
  const rangeStart = addDays(s.lastFrost, -70);
  const rangeEnd = addDays(s.firstFrost, 45);
  const defaultView = () => (today >= rangeStart && today <= rangeEnd ? today : addDays(s.lastFrost, -56));
  const [view, setView] = useState<Date>(defaultView);
  useEffect(() => setView(defaultView()), [season]); // eslint-disable-line react-hooks/exhaustive-deps
  const [brush, setBrush] = useState<Brush>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<'auto' | 'direct' | 'transplant'>('auto');
  const [filter, setFilter] = useState<PaletteFilter>('all');
  const [showSun, setShowSun] = useState(true);
  const [toast, setToast] = useState<{ tone: 'good' | 'warning' | 'critical'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const nowIds = useMemo(() => new Set(plantNow(site, today).map((x) => x.plant.id)), [site, today]);
  const stroke = useRef<{ visited: Set<string>; placed: { start: Date; text: string }[]; skipped: number; failed: string | null; erased: number } | null>(null);

  // Leaves the garden untouched (no undo step, no save) when the bed function returns the same bed.
  const updateBed = (fn: (b: Bed) => Bed) =>
    bed &&
    update((g) => {
      let changed = false;
      const beds = g.beds.map((b) => {
        if (b.id !== bed.id) return b;
        const nb = fn(b);
        if (nb !== b) changed = true;
        return nb;
      });
      return changed ? { ...g, beds } : g;
    });

  const sunAt = useMemo(() => {
    const m = sun.season;
    if (!m || !bed) return undefined;
    return (c: number, r: number) => sampleMap(m, 'sunHours', bed.x + c + 0.5, bed.y + r + 0.5);
  }, [sun.season, bed]);

  if (!bed) {
    return (
      <div className="view empty">
        <p>No beds yet.</p>
        <button className="primary" onClick={() => { const b = newBed({ name: 'Bed 1' }); update((g) => ({ ...g, beds: [b] })); setSelectedBedId(b.id); }}>Add a 4×4 bed</button>
        <p className="muted">Or draw one on the <button className="link" onClick={() => setTab('site')}>Site map</button> where the sun is best.</p>
      </div>
    );
  }

  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  const occ = occupancyAt(bed, site, view);
  const seasonPlantings = bed.plantings.filter((p) => p.season === season && PLANT_BY_ID[p.plantId]);
  const warnings = bedWarnings(bed, site, sunAt, season);
  const summary = bedSummary(bed, site, season, view);

  const nextIn = (c: number, r: number) =>
    seasonPlantings
      .filter((p) => cellsOf(p).some(([cc, rr]) => cc === c && rr === r))
      .map((p) => ({ p, iv: plantingInterval(p, site) }))
      .filter((x) => x.iv.start > view)
      .sort((a, b) => a.iv.start.getTime() - b.iv.start.getTime())[0];
  const countIn = (c: number, r: number) => seasonPlantings.filter((p) => cellsOf(p).some(([cc, rr]) => cc === c && rr === r)).length;

  type PlaceResult = { ok: true; start: Date; before?: string; window: number } | { ok: false; reason: string } | { skipped: true };
  /**
   * Plan `plant` in square (c, r) against the latest bed state (so several placements in one drag see
   * each other). When `continuing` a drag, busy squares are skipped instead of queued after the crop.
   */
  const place = (plant: PlantType, c: number, r: number, continuing = false): PlaceResult => {
    const m: 'direct' | 'transplant' = method === 'auto' ? (plant.startIndoorsWeeks != null || (!plant.directSow && plant.transplantWeeks != null) ? 'transplant' : 'direct') : method;
    const earliest = view > today ? view : today > rangeStart ? today : undefined;
    let out: PlaceResult = { skipped: true };
    updateBed((b) => {
      if (continuing && cellsOfSpan(c, r, plant.span).some(([cc, rr]) => occupancyAt(b, site, view)[rr * w + cc])) return b;
      const res = scheduleSlot(b, site, plant, m, c, r, season, { earliest });
      if (!res.ok) {
        out = res;
        return b;
      }
      const before = squareHistory(b, site, c, r).filter((x) => x.iv.end <= res.start && x.pl.season === season).pop();
      out = { ok: true, start: res.start, before: before?.plant.name, window: res.window };
      const pl: BedPlanting = { id: uid('pl'), plantId: plant.id, col: c, row: r, method: m, season, plannedOn: isoDate(res.start) };
      return { ...b, plantings: [...b.plantings, pl] };
    });
    return out;
  };

  const erase = (c: number, r: number): boolean => {
    let hit = false;
    updateBed((b) => {
      const id = occupancyAt(b, site, view)[r * w + c] ??
        b.plantings
          .filter((p) => p.season === season && cellsOf(p).some(([cc, rr]) => cc === c && rr === r))
          .map((p) => ({ p, iv: plantingInterval(p, site) }))
          .filter((x) => x.iv.start > view)
          .sort((a, b2) => a.iv.start.getTime() - b2.iv.start.getTime())[0]?.p.id;
      if (!id) return b;
      hit = true;
      return { ...b, plantings: b.plantings.filter((p) => p.id !== id) };
    });
    return hit;
  };

  // One brush stroke = a click or a drag across squares; summarised in a single toast.
  const strokeCell = (c: number, r: number, continuing: boolean) => {
    const s = stroke.current;
    if (!s || !brush) return;
    const key = `${c},${r}`;
    if (s.visited.has(key)) return;
    s.visited.add(key);
    if (brush.kind === 'erase') {
      if (erase(c, r)) s.erased++;
      return;
    }
    const res = place(brush.plant, c, r, continuing);
    if ('skipped' in res) s.skipped++;
    else if (!res.ok) s.failed = res.reason;
    else {
      s.placed.push({ start: res.start, text: `${brush.plant.name} planned for ${fmtDate(res.start)}${res.before ? ` after ${res.before}` : ''}${res.window > 0 ? ' (later window)' : ''}` });
    }
  };
  const endStroke = () => {
    const s = stroke.current;
    stroke.current = null;
    if (!s || !brush) return;
    if (brush.kind === 'erase') return;
    if (!s.placed.length) {
      if (s.failed) setToast({ tone: 'warning', text: s.failed });
      else if (s.skipped) setToast({ tone: 'warning', text: 'Those squares are busy on this date — click one square to queue a crop after what’s there' });
      return;
    }
    const first = s.placed.reduce((a, x) => (x.start < a ? x.start : a), s.placed[0].start);
    // Only toast once the stroke is over: a toast appearing mid-drag would shift the grid under the pointer.
    if (s.placed.length > 1 || s.skipped)
      setToast({ tone: 'good', text: `${brush.plant.name} planned in ${s.placed.length} square${s.placed.length > 1 ? 's' : ''} from ${fmtDate(first)}${s.skipped ? ` · skipped ${s.skipped} busy` : ''}` });
    else setToast({ tone: 'good', text: s.placed[0].text });
    if (Math.abs(first.getTime() - view.getTime()) > 30 * DAY && first > view) setView(first);
  };
  const beginStroke = (c: number, r: number) => {
    stroke.current = { visited: new Set(), placed: [], skipped: 0, failed: null, erased: 0 };
    strokeCell(c, r, false);
  };
  const cellAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-cell]');
    return el ? { c: Number(el.dataset.c), r: Number(el.dataset.r) } : null;
  };
  const onGridPointerDown = (e: ReactPointerEvent) => {
    if (!brush || e.button > 0) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    beginStroke(cell.c, cell.r);
    const move = (ev: PointerEvent) => {
      const at = cellAt(ev.clientX, ev.clientY);
      if (at) strokeCell(at.c, at.r, true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      endStroke();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const clickCell = (c: number, r: number, viaKeyboard: boolean) => {
    if (brush) {
      // Pointer strokes are handled on pointerdown; keyboard activation paints one square.
      if (viaKeyboard) {
        beginStroke(c, r);
        endStroke();
      }
      return;
    }
    const id = occ[r * w + c];
    setSel({ kind: 'square', col: c, row: r, plantingId: id ?? nextIn(c, r)?.p.id });
  };

  const bedSun = bed.analysis?.sunHours;
  const q = query.toLowerCase();
  const filtered = PLANTS.filter((p) => !q || p.name.toLowerCase().includes(q) || p.family.toLowerCase().includes(q)).filter((p) =>
    filter === 'now' ? nowIds.has(p.id) : filter === 'sun' ? bedSun == null || bedSun >= p.minSunHours : filter === 'cool' || filter === 'warm' ? p.season === filter : true,
  );
  const span = rangeEnd.getTime() - rangeStart.getTime();

  return (
    <div className="view beds-view">
      <div className="row between wrap gap">
        <div className="bed-tabs" role="tablist" aria-label="Beds">
          {garden.beds.map((b) => (
            <button key={b.id} role="tab" aria-selected={b.id === bed.id} className={b.id === bed.id ? 'active' : ''} onClick={() => { setSelectedBedId(b.id); setSel(null); }}>
              {b.name} <span className="muted small">{b.widthFt}×{b.lengthFt}</span>
            </button>
          ))}
          <button onClick={() => { const b = newBed({ name: `Bed ${garden.beds.length + 1}`, x: 2, y: 2 }); update((g) => ({ ...g, beds: [...g.beds, b] })); setSelectedBedId(b.id); }}>+ Bed</button>
        </div>
        <div className="row gap">
          <button onClick={() => setSeason(season - 1)} aria-label="Previous season">‹</button>
          <b>{season} season</b>
          <button onClick={() => setSeason(season + 1)} aria-label="Next season">›</button>
        </div>
      </div>

      <div className="beds-layout">
        <aside className="palette card">
          <h3>Plants</h3>
          <input type="search" placeholder="Search plants…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search plants" />
          <div className="segmented small">
            {(['auto', 'direct', 'transplant'] as const).map((m) => (
              <button key={m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>{m === 'auto' ? 'Auto' : m === 'direct' ? 'Sow' : 'Transplant'}</button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Filter plants">
            {FILTERS.map((f) => (
              <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} aria-pressed={filter === f.id} title={f.title} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <button className={`palette-item erase ${brush?.kind === 'erase' ? 'active' : ''}`} onClick={() => setBrush(brush?.kind === 'erase' ? null : { kind: 'erase' })}>⌫ Eraser</button>
          <div className="palette-list">
            {!filtered.length && <p className="muted small">{filter === 'now' ? 'Nothing is in its planting window today.' : 'No plants match.'}</p>}
            {filtered.map((p) => {
              const fits = bedSun == null || bedSun >= p.minSunHours;
              return (
                <button key={p.id} className={`palette-item ${brush?.kind === 'plant' && brush.plant.id === p.id ? 'active' : ''}`} onClick={() => setBrush(brush?.kind === 'plant' && brush.plant.id === p.id ? null : { kind: 'plant', plant: p })} title={p.notes}>
                  <span className="pi-icon" aria-hidden="true">{p.icon}</span>
                  <span className="grow">
                    {p.name}
                    <span className="muted small block">{p.span > 1 ? `${p.span}×${p.span} sq` : `${p.perSquare}/sq`} · {p.minSunHours}h+ · {p.daysToMaturity}d · {p.feeder}</span>
                  </span>
                  {!fits && <span className="status-dot critical" title="This bed gets less sun than this plant needs">!</span>}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="bed-main">
          <div className="card scrubber">
            <div className="row between wrap gap">
              <b>Bed on {fmtDate(view, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b>
              <span className="row gap">
                <button className="small" onClick={() => setView(today)} disabled={today < rangeStart || today > rangeEnd}>Today</button>
                <label className="row gap small"><input type="checkbox" checked={showSun} onChange={(e) => setShowSun(e.target.checked)} /> Sun tint</label>
              </span>
            </div>
            <input type="range" min={0} max={Math.round(span / DAY)} value={Math.round((view.getTime() - rangeStart.getTime()) / DAY)} onChange={(e) => setView(addDays(rangeStart, +e.target.value))} aria-label="Date shown" className="full" />
            <div className="row between small muted"><span>{fmtDate(rangeStart)}</span><span>Last frost {fmtDate(s.lastFrost)}</span><span>First frost {fmtDate(s.firstFrost)}</span><span>{fmtDate(rangeEnd)}</span></div>
            <div className="muted small">
              {brush?.kind === 'plant' ? `Click or drag across squares to plan ${brush.plant.name}. Clicking a busy square queues it after the current crop; dragging skips busy squares.` : brush?.kind === 'erase' ? 'Click or drag across plantings to remove them from the plan.' : 'Pick a plant and click or drag across squares, or click a square to see its history and what can follow.'}
            </div>
          </div>
          {toast && <div className="toast" role="status"><Status tone={toast.tone}>{toast.text}</Status></div>}

          <div className={`sfg ${brush ? 'painting' : ''}`} style={{ gridTemplateColumns: `repeat(${w}, minmax(44px, 72px))` }} role="grid" aria-label={`${bed.name} square-foot grid`} onPointerDown={onGridPointerDown}>
            {Array.from({ length: h }).flatMap((_, r) =>
              Array.from({ length: w }).map((_, c) => {
                const id = occ[r * w + c];
                const pl = id ? bed.plantings.find((p) => p.id === id) : undefined;
                const plant = pl ? PLANT_BY_ID[pl.plantId] : undefined;
                const isAnchor = pl && pl.col === c && pl.row === r;
                const nxt = !pl ? nextIn(c, r) : undefined;
                const sunH = sunAt?.(c, r);
                const warn = pl && warnings.some((x) => x.plantingId === pl.id && x.level !== 'info');
                const st = pl && plant ? stageAt(plant, pl.plantedOn, pl.method, view) : null;
                const n = countIn(c, r);
                const isSel = sel?.col === c && sel?.row === r;
                return (
                  <button
                    key={`${c}-${r}`}
                    role="gridcell"
                    className={`sq ${pl ? 'filled' : ''} ${isSel ? 'selected' : ''} ${pl && !isAnchor ? 'cont' : ''} ${pl && !pl.plantedOn ? 'is-planned' : ''}`}
                    style={showSun && sunH != null ? { background: rampCss((sunH / SUN_SCALE_MAX) * 0.55) } : undefined}
                    data-cell="" data-c={c} data-r={r}
                    onClick={(e) => clickCell(c, r, e.detail === 0)}
                    title={`${plant ? plant.name + (pl!.plantedOn ? ' (planted ' + fmtDate(pl!.plantedOn) + ')' : ' (planned)') : nxt ? 'Next: ' + (PLANT_BY_ID[nxt.p.plantId]?.name ?? nxt.p.plantId) + ' ' + fmtDate(nxt.iv.start) : 'Empty'}${sunH != null ? ' · ' + sunH.toFixed(1) + ' h sun' : ''}`}
                  >
                    {plant && isAnchor && (
                      <>
                        <span className="sq-icon" aria-hidden="true">{plant.icon}</span>
                        <span className="sq-count tabular">{plantCount(pl!, plant) > 1 ? `×${plantCount(pl!, plant)}` : ''}</span>
                        {st && st.stage !== 'planned' && <span className="sq-stage" style={{ width: `${Math.min(100, st.frac * 100)}%` }} />}
                      </>
                    )}
                    {plant && !isAnchor && <span className="sq-icon faint" aria-hidden="true">{plant.icon}</span>}
                    {!plant && nxt && (
                      <span className="sq-next">
                        <span aria-hidden="true">{PLANT_BY_ID[nxt.p.plantId].icon}</span>
                        <span className="tabular">{fmtDate(nxt.iv.start, { month: 'numeric', day: 'numeric' })}</span>
                      </span>
                    )}
                    {n > 1 && <span className="sq-multi" title={`${n} plantings this season`}>{n}</span>}
                    {warn && isAnchor && <span className="sq-warn" aria-label="Has warnings">!</span>}
                    {!plant && !nxt && sunH != null && showSun && <span className="sq-sun tabular">{sunH.toFixed(0)}h</span>}
                  </button>
                );
              }),
            )}
          </div>
          <p className="muted small">Solid icons are in the ground on the date shown (dashed outline = planned). Faint icon + date = next crop due in that square. {site.lat >= 0 ? 'Top edge is north when the map has north up — tall crops there.' : 'Tall crops on the south edge (southern hemisphere).'}</p>

          <BedSeasonStrip bed={bed} season={season} view={view} rangeStart={rangeStart} rangeEnd={rangeEnd} onSelect={(pl) => { setSel({ kind: 'square', col: pl.col, row: pl.row, plantingId: pl.id }); setView(plantingInterval(pl, site).start > view ? plantingInterval(pl, site).start : view); }} />

          {warnings.length > 0 && (
            <section className="card">
              <h4>Checks for {season}</h4>
              <ul className="warnings">
                {warnings.map((wn, i) => (
                  <li key={i}><Status tone={wn.level === 'bad' ? 'critical' : wn.level === 'warn' ? 'warning' : 'info'}>{wn.message}</Status></li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="side-col">
          {sel ? (
            <SquarePanel bed={bed} col={sel.col} row={sel.row} selectedId={sel.plantingId} season={season}
              onSelect={(id) => setSel({ ...sel, plantingId: id })}
              onClose={() => setSel(null)}
              updateBed={updateBed}
              onPlanned={(text) => setToast(text.startsWith('⚠ ') ? { tone: 'warning', text: text.slice(2) } : { tone: 'good', text })} />
          ) : (
            <BedPanel bed={bed} season={season} view={view} summary={summary} updateBed={updateBed} />
          )}
        </aside>
      </div>
    </div>
  );
}

function BedSeasonStrip({ bed, season, view, rangeStart, rangeEnd, onSelect }: { bed: Bed; season: number; view: Date; rangeStart: Date; rangeEnd: Date; onSelect: (pl: BedPlanting) => void }) {
  const { garden } = useGarden();
  const site = garden.site;
  const [ref, width] = useElementWidth<HTMLDivElement>();
  // Group squares of the same crop going in on the same day.
  const groups = new Map<string, { pl: BedPlanting; n: number; start: Date; end: Date; planted: boolean }>();
  for (const pl of bed.plantings) {
    if (pl.season !== season || !PLANT_BY_ID[pl.plantId]) continue;
    const iv = plantingInterval(pl, site);
    const k = `${pl.plantId}|${isoDate(iv.start)}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { pl, n: 1, start: iv.start, end: iv.end, planted: !!pl.plantedOn });
  }
  const rows = [...groups.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  const W = Math.max(320, width || 600);
  const L = 120;
  const rowH = 20;
  const H = 22 + rows.length * rowH + 6;
  const span = rangeEnd.getTime() - rangeStart.getTime();
  const x = (d: Date) => L + Math.max(0, Math.min(1, (d.getTime() - rangeStart.getTime()) / span)) * (W - L - 6);
  const months: Date[] = [];
  for (let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 1); d < rangeEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  if (!rows.length) return null;
  return (
    <section className="card">
      <h4>{bed.name} through {season}</h4>
      <div className="legend" aria-hidden="true">
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-3)' }} />Planted</span>
        <span className="legend-item"><span className="legend-swatch planned-swatch" />Planned</span>
      </div>
      <div ref={ref} className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Season plan for ${bed.name}`}>
          {months.map((m) => (
            <g key={m.toISOString()}>
              <line x1={x(m)} x2={x(m)} y1={14} y2={H - 2} className="grid" />
              <text x={x(m) + 3} y={10} className="axis-label">{m.toLocaleDateString(undefined, { month: 'short' })}</text>
            </g>
          ))}
          <line x1={x(view)} x2={x(view)} y1={14} y2={H - 2} className="today-line" />
          {rows.map((g, i) => {
            const p = PLANT_BY_ID[g.pl.plantId];
            const y = 18 + i * rowH;
            return (
              <g key={i} onClick={() => onSelect(g.pl)} style={{ cursor: 'pointer' }}>
                <text x={4} y={y + 13} className="axis-label strong">{p.icon} {p.name}{g.n > 1 ? ` ×${g.n}` : ''}</text>
                <rect x={x(g.start)} y={y + 3} width={Math.max(4, x(g.end) - x(g.start))} height={rowH - 7} rx={4}
                  fill={g.planted ? 'var(--series-3)' : 'var(--planned-fill)'} stroke={g.planted ? 'none' : 'var(--series-3)'} strokeDasharray={g.planted ? undefined : '4 3'} strokeWidth={1.5}>
                  <title>{`${p.name}: ${fmtDate(g.start)} – ${fmtDate(g.end)}${g.planted ? '' : ' (planned)'}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function SquarePanel({ bed, col, row, selectedId, season, onSelect, onClose, updateBed, onPlanned }: {
  bed: Bed; col: number; row: number; selectedId?: string; season: number;
  onSelect: (id: string) => void; onClose: () => void; updateBed: (fn: (b: Bed) => Bed) => void; onPlanned: (t: string) => void;
}) {
  const { garden } = useGarden();
  const site = garden.site;
  const hist = squareHistory(bed, site, col, row).reverse();
  const pl = selectedId ? bed.plantings.find((p) => p.id === selectedId) : undefined;
  // Suggestions follow whatever is last in this square this season (not necessarily the selected crop).
  const last = hist.filter((x) => x.pl.season === season && !x.plant.perennial).sort((a, b) => b.iv.end.getTime() - a.iv.end.getTime())[0]?.pl;
  const suggestions = useMemo(() => (last ? followOns(bed, site, last, 6) : []), [bed, site, last]);

  return (
    <>
      <section className="card">
        <div className="row between">
          <h3>Square {String.fromCharCode(65 + col)}{row + 1}</h3>
          <button className="link" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {hist.length === 0 && <p className="muted">Nothing planned here. Pick a plant on the left and click this square.</p>}
        <ul className="history">
          {hist.map(({ pl: p, plant, iv }) => (
            <li key={p.id}>
              <button className={`history-item ${p.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(p.id)}>
                <span aria-hidden="true">{plant.icon}</span>
                <span className="grow">
                  {plant.name} <span className="muted small">{p.season}</span>
                  <span className="muted small block">{fmtDate(iv.start)} – {plant.perennial && !p.removedOn ? 'perennial' : fmtDate(iv.end)}{!p.plantedOn ? ' · planned' : p.removedOn ? ' · done' : ' · growing'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {pl && <PlantingPanel bed={bed} pl={pl} updateBed={updateBed} onPlanned={onPlanned} />}
      {last && suggestions.length > 0 && (
        <section className="card">
          <h4>Plant after {PLANT_BY_ID[last.plantId].name} ({fmtDate(plantingInterval(last, site).end)})</h4>
          <p className="muted small">Fits the gap before frost, ranked for rotation and feeding.</p>
          <ul className="follow">
            {suggestions.map((f) => (
              <li key={f.plant.id}>
                <span aria-hidden="true">{f.plant.icon}</span>
                <span className="grow">
                  <b>{f.plant.name}</b> <span className="muted small">{f.method === 'transplant' ? 'transplant' : 'sow'} {fmtDate(f.start)}</span>
                  <span className="muted small block">{f.why}</span>
                </span>
                <button className="small" onClick={() => {
                  const np: BedPlanting = { id: uid('pl'), plantId: f.plant.id, col: last.col, row: last.row, method: f.method, season: last.season, plannedOn: isoDate(f.start) };
                  updateBed((b) => ({ ...b, plantings: [...b.plantings, np] }));
                  onPlanned(`${f.plant.name} planned for ${fmtDate(f.start)} after ${PLANT_BY_ID[last.plantId].name}`);
                }}>Plan</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PlantingPanel({ bed, pl, updateBed, onPlanned }: { bed: Bed; pl: BedPlanting; updateBed: (fn: (b: Bed) => Bed) => void; onPlanned: (t: string) => void }) {
  const { garden, update } = useGarden();
  const site = garden.site;
  const plant = PLANT_BY_ID[pl.plantId];
  const todayIso = isoDate(new Date());
  const iv = plantingInterval(pl, site);
  const st = stageAt(plant, pl.plantedOn, pl.method, new Date());
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState<NonNullable<JournalEntry['unit']>>('lb');
  const change = (fn: (p: BedPlanting) => BedPlanting) => updateBed((b) => ({ ...b, plantings: b.plantings.map((p) => (p.id === pl.id ? fn(p) : p)) }));
  const clash = bed.plantings.some((o) => o.id !== pl.id && PLANT_BY_ID[o.plantId] && cellsOf(o).some(([c, r]) => cellsOf(pl).some(([c2, r2]) => c === c2 && r === r2)) && (() => { const oi = plantingInterval(o, site); return oi.start < iv.end && iv.start < oi.end; })());
  const harvested = garden.journal.filter((e) => e.kind === 'harvest' && e.plantingId === pl.id);
  const logHarvest = () => {
    const e: JournalEntry = { id: uid('j'), date: todayIso, kind: 'harvest', bedId: bed.id, plantingId: pl.id, plantId: plant.id, qty, unit };
    update((g) => ({ ...g, journal: [...g.journal, e] }));
  };

  return (
    <section className="card">
      <h3><span aria-hidden="true">{plant.icon}</span> {plant.name}</h3>
      <p className="muted small">{plant.family} · {plant.season}-season · {plant.frost} · {plant.feeder} feeder · pH {plant.ph[0]}–{plant.ph[1]} · {plant.minSunHours}–{plant.idealSunHours}h sun</p>
      {plant.notes && <p className="small">{plant.notes}</p>}
      {clash && <Status tone="warning">Overlaps another crop in these squares — adjust the dates.</Status>}
      <div className="grid2">
        <Field label="Planned for">
          <input type="date" value={pl.plannedOn ?? isoDate(iv.start)} onChange={(e) => e.target.value && change((p) => ({ ...p, plannedOn: e.target.value }))} />
        </Field>
        <Field label="Method">
          <select value={pl.method} onChange={(e) => change((p) => ({ ...p, method: e.target.value as BedPlanting['method'] }))}>
            <option value="direct">Direct sow</option>
            <option value="transplant">Transplant</option>
          </select>
        </Field>
        <Field label="Planted on">
          <input type="date" value={pl.plantedOn ?? ''} onChange={(e) => change((p) => ({ ...p, plantedOn: e.target.value || undefined }))} />
        </Field>
        <Field label="Pulled on">
          <input type="date" value={pl.removedOn ?? ''} onChange={(e) => change((p) => ({ ...p, removedOn: e.target.value || undefined }))} />
        </Field>
        {plant.span === 1 && (
          <Field label="Plants in square"><NumberInput value={plantCount(pl, plant)} min={1} max={32} onChange={(v) => change((p) => ({ ...p, count: Math.round(v) }))} /></Field>
        )}
      </div>
      <div className="row gap wrap">
        {!pl.plantedOn && <button className="primary" onClick={() => change((p) => ({ ...p, plantedOn: todayIso }))}>Planted today</button>}
        {pl.plantedOn && !pl.removedOn && <button onClick={() => change((p) => ({ ...p, removedOn: todayIso }))}>Pulled today</button>}
        {!plant.perennial && (
          <button title={`Plan another ${plant.name} sowing ${plant.successionDays ?? 14} days after the latest one, in the nearest free square`} onClick={() => {
            const res = nextSuccession(bed, site, pl);
            if (!res.ok) return onPlanned(`⚠ ${res.reason}`);
            const np: BedPlanting = { id: uid('pl'), plantId: plant.id, col: res.col, row: res.row, method: pl.method, season: pl.season, plannedOn: isoDate(res.start), count: pl.count };
            updateBed((b) => ({ ...b, plantings: [...b.plantings, np] }));
            onPlanned(`Next ${plant.name} sowing planned for ${fmtDate(res.start)} in square ${String.fromCharCode(65 + res.col)}${res.row + 1}`);
          }}>+ Succession <span className="muted small">every {plant.successionDays ?? 14} d</span></button>
        )}
      </div>
      {pl.plantedOn && !pl.removedOn && (
        <>
          <p className="small">Stage: <b>{st.stage}</b> · expected harvest from {fmtDate(addDays(parseIso(pl.plantedOn), Math.round(plant.daysToMaturity * (pl.method === 'transplant' ? 0.88 : 1))))}</p>
          <Meter value={Math.min(1, st.frac)} label="Progress to maturity" tone={st.frac >= 1 ? 'good' : 'accent'} />
        </>
      )}
      {pl.plantedOn && (
        <>
          <h4>Harvest</h4>
          <div className="row gap wrap">
            <NumberInput value={qty} min={0} step={0.25} onChange={setQty} />
            <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} aria-label="Unit">
              {(['lb', 'oz', 'kg', 'g', 'count', 'bunch'] as const).map((u) => <option key={u}>{u}</option>)}
            </select>
            <button onClick={logHarvest}>Log harvest</button>
          </div>
          {harvested.length > 0 && <p className="small muted">{harvested.length} harvest{harvested.length > 1 ? 's' : ''} logged: {harvested.map((e) => `${e.qty} ${e.unit}`).join(', ')}</p>}
        </>
      )}
      <h4>Companions</h4>
      <p className="small"><b>Good:</b> {plant.companions.map((id) => PLANT_BY_ID[id]?.name ?? id).join(', ') || '—'}</p>
      <p className="small"><b>Avoid:</b> {plant.avoid.map((id) => PLANT_BY_ID[id]?.name ?? id).join(', ') || '—'}</p>
      <button className="danger" onClick={() => updateBed((b) => ({ ...b, plantings: b.plantings.filter((p) => p.id !== pl.id) }))}>Delete planting</button>
    </section>
  );
}

function BedPanel({ bed, season, view, summary, updateBed }: { bed: Bed; season: number; view: Date; summary: ReturnType<typeof bedSummary>; updateBed: (fn: (b: Bed) => Bed) => void }) {
  const { garden } = useGarden();
  const soil = soilAdvice(bed, garden.site, season);
  const compost = compostNeeded(bed, 1);
  const outside = plantingsOutside(bed);
  const [ph, setPh] = useState(soil.test?.ph ?? 6.5);
  const [om, setOm] = useState<number | undefined>(soil.test?.organicMatterPct);
  const [npk, setNpk] = useState<{ n?: NutrientLevel; p?: NutrientLevel; k?: NutrientLevel }>({ n: soil.test?.n, p: soil.test?.p, k: soil.test?.k });
  const [adding, setAdding] = useState(false);
  const todayIso = isoDate(new Date());
  const due = bed.plantings.filter((p) => !p.plantedOn && p.season === season && plantingInterval(p, garden.site).start <= addDays(new Date(), 3));
  const lvl = (k: 'n' | 'p' | 'k', label: string) => (
    <Field label={label}>
      <select value={npk[k] ?? ''} onChange={(e) => setNpk({ ...npk, [k]: (e.target.value || undefined) as NutrientLevel | undefined })}>
        <option value="">—</option>
        {(['low', 'medium', 'high', 'very-high'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </Field>
  );
  return (
    <>
      <section className="card">
        <h3>{bed.name}</h3>
        <div className="grid2">
          <Field label="Name"><input value={bed.name} onChange={(e) => updateBed((b) => ({ ...b, name: e.target.value }))} /></Field>
          <Field label="Soil depth"><NumberInput value={bed.soilDepthIn} min={4} max={36} suffix="in" onChange={(v) => updateBed((b) => ({ ...b, soilDepthIn: v }))} /></Field>
          <Field label="Width"><NumberInput commitOnBlur value={bed.widthFt} min={1} max={20} suffix="ft" onChange={(v) => updateBed((b) => ({ ...b, widthFt: Math.round(v) }))} /></Field>
          <Field label="Length"><NumberInput commitOnBlur value={bed.lengthFt} min={1} max={40} suffix="ft" onChange={(v) => updateBed((b) => ({ ...b, lengthFt: Math.round(v) }))} /></Field>
        </div>
        <Field label="Soil">
          <select value={bed.soil} onChange={(e) => updateBed((b) => ({ ...b, soil: e.target.value as SoilType }))}>
            {Object.entries(SOILS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </Field>
        <label className="row gap"><input type="checkbox" checked={bed.mulched} onChange={(e) => updateBed((b) => ({ ...b, mulched: e.target.checked }))} /> Mulched</label>
        {outside.length > 0 && (
          <div className="card inset">
            <Status tone="critical">{outside.length} planting{outside.length > 1 ? 's' : ''} no longer fit this {Math.round(bed.widthFt)}×{Math.round(bed.lengthFt)} ft bed.</Status>
            <div className="row gap wrap">
              <button className="small danger" onClick={() => updateBed((b) => ({ ...b, plantings: b.plantings.filter((p) => !outside.some((o) => o.id === p.id)) }))}>Remove them</button>
              <span className="muted small">or make the bed bigger again to keep them.</span>
            </div>
          </div>
        )}
        {bed.analysis && <p>Season sun: <b>{bed.analysis.sunHours.toFixed(1)} h/day</b> · DLI {bed.analysis.dli.toFixed(0)}</p>}
        <h4>On {fmtDate(view)}</h4>
        <Meter value={summary.used} max={summary.area} label="Squares in use" />
        <p className="muted small">{summary.used} of {summary.area} squares in use · {season} plan expects ~{summary.expectedLb.toFixed(0)} lb</p>
        <ul className="counts">
          {[...summary.counts].map(([id, n]) => (
            <li key={id}><span aria-hidden="true">{PLANT_BY_ID[id].icon}</span> {PLANT_BY_ID[id].name} <b className="tabular">{n}</b></li>
          ))}
        </ul>
        <div className="row gap wrap">
          <button disabled={!due.length} onClick={() => updateBed((b) => ({ ...b, plantings: b.plantings.map((p) => (due.some((d) => d.id === p.id) ? { ...p, plantedOn: todayIso } : p)) }))}>
            Mark {due.length || ''} due as planted today
          </button>
          <button className="danger" onClick={() => { if (confirm(`Remove all ${season} plantings from this bed?`)) updateBed((b) => ({ ...b, plantings: b.plantings.filter((p) => p.season !== season) })); }}>Clear {season} plan</button>
        </div>
      </section>

      <section className="card">
        <h3>Soil</h3>
        {soil.test && <p className="small">Last test {fmtDate(soil.test.date, { month: 'short', day: 'numeric', year: 'numeric' })}: pH <b>{soil.test.ph}</b>{soil.test.organicMatterPct != null ? ` · OM ${soil.test.organicMatterPct}%` : ''}{soil.test.n ? ` · N ${soil.test.n}` : ''}{soil.test.p ? ` · P ${soil.test.p}` : ''}{soil.test.k ? ` · K ${soil.test.k}` : ''}</p>}
        <ul className="warnings">
          {soil.advice.map((a, i) => <li key={i}><Status tone={a.level === 'good' ? 'good' : a.level === 'warn' ? 'warning' : 'info'}>{a.message}</Status></li>)}
        </ul>
        {soil.amendment && (
          <p className="small"><b>{soil.amendment.product === 'lime' ? 'Raise' : 'Lower'} pH to {soil.target?.target}:</b> {soil.amendment.lbTotal.toFixed(1)} lb {soil.amendment.product} for this bed ({soil.amendment.lbPer100SqFt.toFixed(1)} lb / 100 sq ft). {soil.amendment.note}</p>
        )}
        <p className="small muted">1" compost top-dressing: {compost.cuft.toFixed(1)} cu ft (≈ {compost.bags} one-cubic-foot bags).</p>
        {!adding ? <button onClick={() => setAdding(true)}>Record soil test</button> : (
          <div className="card inset">
            <div className="grid2">
              <Field label="pH"><NumberInput value={ph} step={0.1} min={3} max={10} onChange={setPh} /></Field>
              <Field label="Organic matter"><NumberInput value={om ?? NaN} step={0.5} min={0} max={80} suffix="%" onChange={setOm} /></Field>
              {lvl('n', 'Nitrogen')}
              {lvl('p', 'Phosphorus')}
              {lvl('k', 'Potassium')}
            </div>
            <div className="row gap">
              <button className="primary" onClick={() => { updateBed((b) => ({ ...b, soilTests: [...(b.soilTests ?? []), { date: todayIso, ph, organicMatterPct: om, ...npk }] })); setAdding(false); }}>Save test</button>
              <button onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
