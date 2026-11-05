import { useMemo, useState } from 'react';
import type { Bed, BedPlanting, SoilType } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { PLANTS, PLANT_BY_ID, type PlantType } from '../../core/plants.ts';
import { bedSummary, bedWarnings, canPlace, occupancy, plantCount } from '../../core/bed.ts';
import { sampleMap } from '../../core/placement.ts';
import { SOILS, stageAt } from '../../core/water.ts';
import { newBed } from '../../core/defaults.ts';
import { isoDate, uid, fmtDate, parseIso, addDays } from '../../core/util.ts';
import { rampCss, SUN_SCALE_MAX } from '../sunColors.ts';
import { Field, NumberInput, Status } from '../components/Field.tsx';
import { Meter } from '../components/Chart.tsx';

type Brush = { kind: 'plant'; plant: PlantType } | { kind: 'erase' } | null;

export function BedsView() {
  const { garden, update, selectedBedId, setSelectedBedId, sun, setTab } = useGarden();
  const bed = garden.beds.find((b) => b.id === selectedBedId) ?? garden.beds[0];
  const [brush, setBrush] = useState<Brush>(null);
  const [selPlanting, setSelPlanting] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<'auto' | 'direct' | 'transplant'>('auto');
  const [showSun, setShowSun] = useState(true);

  const updateBed = (fn: (b: Bed) => Bed) => bed && update((g) => ({ ...g, beds: g.beds.map((b) => (b.id === bed.id ? fn(b) : b)) }));

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
  const occ = occupancy(bed);
  const warnings = bedWarnings(bed, garden.site, sunAt);
  const summary = bedSummary(bed);
  const today = new Date();
  const selected = bed.plantings.find((p) => p.id === selPlanting);

  const clickCell = (c: number, r: number) => {
    const id = occ[r * w + c];
    if (brush?.kind === 'erase') {
      if (id) updateBed((b) => ({ ...b, plantings: b.plantings.filter((p) => p.id !== id) }));
      return;
    }
    if (brush?.kind === 'plant') {
      const plant = brush.plant;
      if (!canPlace(bed, plant, c, r)) {
        if (id) setSelPlanting(id);
        return;
      }
      const m: 'direct' | 'transplant' = method === 'auto' ? (plant.startIndoorsWeeks != null || (!plant.directSow && plant.transplantWeeks != null) ? 'transplant' : 'direct') : method;
      const pl: BedPlanting = { id: uid('pl'), plantId: plant.id, col: c, row: r, method: m };
      updateBed((b) => ({ ...b, plantings: [...b.plantings, pl] }));
      return;
    }
    setSelPlanting(id);
  };

  const filtered = PLANTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.family.toLowerCase().includes(query.toLowerCase()));
  const bedSun = bed.analysis?.sunHours;

  return (
    <div className="view beds-view">
      <div className="bed-tabs" role="tablist" aria-label="Beds">
        {garden.beds.map((b) => (
          <button key={b.id} role="tab" aria-selected={b.id === bed.id} className={b.id === bed.id ? 'active' : ''} onClick={() => { setSelectedBedId(b.id); setSelPlanting(null); }}>
            {b.name} <span className="muted small">{b.widthFt}×{b.lengthFt}</span>
          </button>
        ))}
        <button onClick={() => { const b = newBed({ name: `Bed ${garden.beds.length + 1}`, x: 2, y: 2 }); update((g) => ({ ...g, beds: [...g.beds, b] })); setSelectedBedId(b.id); }}>+ Bed</button>
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
          <button className={`palette-item erase ${brush?.kind === 'erase' ? 'active' : ''}`} onClick={() => setBrush(brush?.kind === 'erase' ? null : { kind: 'erase' })}>⌫ Eraser</button>
          <div className="palette-list">
            {filtered.map((p) => {
              const fits = bedSun == null || bedSun >= p.minSunHours;
              return (
                <button key={p.id} className={`palette-item ${brush?.kind === 'plant' && brush.plant.id === p.id ? 'active' : ''}`} onClick={() => setBrush(brush?.kind === 'plant' && brush.plant.id === p.id ? null : { kind: 'plant', plant: p })} title={p.notes}>
                  <span className="pi-icon" aria-hidden="true">{p.icon}</span>
                  <span className="grow">
                    {p.name}
                    <span className="muted small block">{p.span > 1 ? `${p.span}×${p.span} sq` : `${p.perSquare}/sq`} · {p.minSunHours}h+ sun · {p.daysToMaturity}d</span>
                  </span>
                  {!fits && <span className="status-dot critical" title="This bed gets less sun than this plant needs">!</span>}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="bed-main">
          <div className="row between wrap gap">
            <div className="muted small">
              {brush?.kind === 'plant' ? `Click squares to plant ${brush.plant.name}` : brush?.kind === 'erase' ? 'Click plantings to remove' : 'Pick a plant, then click squares. Click a planting to edit it.'}
            </div>
            <label className="row gap small"><input type="checkbox" checked={showSun} onChange={(e) => setShowSun(e.target.checked)} /> Tint squares by sun</label>
          </div>
          <div className="sfg" style={{ gridTemplateColumns: `repeat(${w}, minmax(44px, 72px))` }} role="grid" aria-label={`${bed.name} square-foot grid`}>
            {Array.from({ length: h }).flatMap((_, r) =>
              Array.from({ length: w }).map((_, c) => {
                const id = occ[r * w + c];
                const pl = id ? bed.plantings.find((p) => p.id === id) : undefined;
                const plant = pl ? PLANT_BY_ID[pl.plantId] : undefined;
                const isAnchor = pl && pl.col === c && pl.row === r;
                const sunH = sunAt?.(c, r);
                const warn = pl && warnings.some((x) => x.plantingId === pl.id && x.level !== 'info');
                const st = pl && plant ? stageAt(plant, pl.plantedOn, pl.method, today) : null;
                return (
                  <button
                    key={`${c}-${r}`}
                    role="gridcell"
                    className={`sq ${pl ? 'filled' : ''} ${pl && pl.id === selPlanting ? 'selected' : ''} ${pl && !isAnchor ? 'cont' : ''}`}
                    style={showSun && sunH != null ? { background: rampCss((sunH / SUN_SCALE_MAX) * 0.55) } : undefined}
                    onClick={() => clickCell(c, r)}
                    title={`${plant ? plant.name + ' — ' : ''}${sunH != null ? sunH.toFixed(1) + ' h sun' : ''}`}
                  >
                    {plant && isAnchor && (
                      <>
                        <span className="sq-icon" aria-hidden="true">{plant.icon}</span>
                        <span className="sq-count tabular">{plantCount(pl!, plant) > 1 ? `×${plantCount(pl!, plant)}` : ''}</span>
                        {st && st.stage !== 'planned' && <span className="sq-stage" style={{ width: `${Math.min(100, st.frac * 100)}%` }} />}
                        {!pl!.plantedOn && <span className="sq-planned">planned</span>}
                      </>
                    )}
                    {plant && !isAnchor && <span className="sq-icon faint" aria-hidden="true">{plant.icon}</span>}
                    {warn && isAnchor && <span className="sq-warn" aria-label="Has warnings">!</span>}
                    {!plant && sunH != null && showSun && <span className="sq-sun tabular">{sunH.toFixed(0)}h</span>}
                  </button>
                );
              }),
            )}
          </div>
          <p className="muted small">{garden.site.lat >= 0 ? 'Top of the grid is the bed’s north edge when the map has north up — put tall crops there.' : 'Southern hemisphere: put tall crops on the south edge.'}</p>

          {warnings.length > 0 && (
            <section className="card">
              <h4>Checks</h4>
              <ul className="warnings">
                {warnings.map((wn, i) => (
                  <li key={i}><Status tone={wn.level === 'bad' ? 'critical' : wn.level === 'warn' ? 'warning' : 'info'}>{wn.message}</Status></li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="side-col">
          {selected ? (
            <PlantingPanel bed={bed} pl={selected} onChange={(fn) => updateBed((b) => ({ ...b, plantings: b.plantings.map((p) => (p.id === selected.id ? fn(p) : p)) }))} onRemove={() => { updateBed((b) => ({ ...b, plantings: b.plantings.filter((p) => p.id !== selected.id) })); setSelPlanting(null); }} />
          ) : (
            <section className="card">
              <h3>{bed.name}</h3>
              <div className="grid2">
                <Field label="Name"><input value={bed.name} onChange={(e) => updateBed((b) => ({ ...b, name: e.target.value }))} /></Field>
                <Field label="Soil depth"><NumberInput value={bed.soilDepthIn} min={4} max={36} suffix="in" onChange={(v) => updateBed((b) => ({ ...b, soilDepthIn: v }))} /></Field>
                <Field label="Width"><NumberInput value={bed.widthFt} min={1} max={20} suffix="ft" onChange={(v) => updateBed((b) => ({ ...b, widthFt: Math.round(v), plantings: b.plantings.filter((p) => p.col < Math.round(v)) }))} /></Field>
                <Field label="Length"><NumberInput value={bed.lengthFt} min={1} max={40} suffix="ft" onChange={(v) => updateBed((b) => ({ ...b, lengthFt: Math.round(v), plantings: b.plantings.filter((p) => p.row < Math.round(v)) }))} /></Field>
              </div>
              <Field label="Soil">
                <select value={bed.soil} onChange={(e) => updateBed((b) => ({ ...b, soil: e.target.value as SoilType }))}>
                  {Object.entries(SOILS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                </select>
              </Field>
              <label className="row gap"><input type="checkbox" checked={bed.mulched} onChange={(e) => updateBed((b) => ({ ...b, mulched: e.target.checked }))} /> Mulched</label>
              {bed.analysis && <p>Season sun: <b>{bed.analysis.sunHours.toFixed(1)} h/day</b> · DLI {bed.analysis.dli.toFixed(0)}</p>}
              <h4>In this bed</h4>
              <Meter value={summary.used} max={summary.area} label="Squares used" />
              <p className="muted small">{summary.used} of {summary.area} squares used</p>
              <ul className="counts">
                {[...summary.counts].map(([id, n]) => (
                  <li key={id}><span aria-hidden="true">{PLANT_BY_ID[id].icon}</span> {PLANT_BY_ID[id].name} <b className="tabular">{n}</b></li>
                ))}
              </ul>
              <div className="row gap wrap">
                <button onClick={() => { const date = isoDate(new Date()); updateBed((b) => ({ ...b, plantings: b.plantings.map((p) => (p.plantedOn ? p : { ...p, plantedOn: date })) })); }} disabled={!bed.plantings.some((p) => !p.plantedOn)}>Mark all planned as planted today</button>
                <button className="danger" onClick={() => { if (confirm('Clear all plantings in this bed?')) updateBed((b) => ({ ...b, plantings: [] })); }}>Clear bed</button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function PlantingPanel({ bed, pl, onChange, onRemove }: { bed: Bed; pl: BedPlanting; onChange: (fn: (p: BedPlanting) => BedPlanting) => void; onRemove: () => void }) {
  const plant = PLANT_BY_ID[pl.plantId];
  const st = stageAt(plant, pl.plantedOn, pl.method, new Date());
  const harvest = pl.plantedOn ? addDays(parseIso(pl.plantedOn), Math.round(plant.daysToMaturity * (pl.method === 'transplant' ? 0.88 : 1))) : null;
  const neighbours = new Set<string>();
  const occ = occupancy(bed);
  const w = Math.round(bed.widthFt);
  for (let dr = -1; dr <= plant.span; dr++)
    for (let dc = -1; dc <= plant.span; dc++) {
      const c = pl.col + dc;
      const r = pl.row + dr;
      if (c < 0 || r < 0 || c >= w || r >= Math.round(bed.lengthFt)) continue;
      const id = occ[r * w + c];
      if (id && id !== pl.id) neighbours.add(bed.plantings.find((p) => p.id === id)!.plantId);
    }
  return (
    <section className="card">
      <h3><span aria-hidden="true">{plant.icon}</span> {plant.name}</h3>
      <p className="muted small">{plant.family} · {plant.season}-season · {plant.frost} · {plant.sun} sun ({plant.minSunHours}–{plant.idealSunHours}h)</p>
      {plant.notes && <p className="small">{plant.notes}</p>}
      <div className="grid2">
        <Field label="Planted on">
          <input type="date" value={pl.plantedOn ?? ''} onChange={(e) => onChange((p) => ({ ...p, plantedOn: e.target.value || undefined }))} />
        </Field>
        <Field label="Method">
          <select value={pl.method} onChange={(e) => onChange((p) => ({ ...p, method: e.target.value as BedPlanting['method'] }))}>
            <option value="direct">Direct sown</option>
            <option value="transplant">Transplanted</option>
          </select>
        </Field>
        {plant.span === 1 && (
          <Field label="Plants in square"><NumberInput value={plantCount(pl, plant)} min={1} max={32} onChange={(v) => onChange((p) => ({ ...p, count: Math.round(v) }))} /></Field>
        )}
      </div>
      {!pl.plantedOn && <button onClick={() => onChange((p) => ({ ...p, plantedOn: isoDate(new Date()) }))}>Planted today</button>}
      {pl.plantedOn && (
        <>
          <p>Stage: <b>{st.stage}</b></p>
          <Meter value={Math.min(1, st.frac)} label="Progress to maturity" tone={st.frac >= 1 ? 'good' : 'accent'} />
          {harvest && <p className="small">Catalogue harvest: ~{fmtDate(harvest)} (see Plan for weather-adjusted dates)</p>}
        </>
      )}
      <h4>Companions</h4>
      <p className="small"><b>Good:</b> {plant.companions.map((id) => PLANT_BY_ID[id]?.name ?? id).join(', ') || '—'}</p>
      <p className="small"><b>Avoid:</b> {plant.avoid.map((id) => PLANT_BY_ID[id]?.name ?? id).join(', ') || '—'}</p>
      {neighbours.size > 0 && (
        <p className="small">Neighbours: {[...neighbours].map((id) => {
          const n = PLANT_BY_ID[id];
          const tone = plant.avoid.includes(id) ? 'critical' : plant.companions.includes(id) ? 'good' : 'info';
          return <Status key={id} tone={tone}>{n.name}</Status>;
        })}</p>
      )}
      <button className="danger" onClick={onRemove}>Remove planting</button>
    </section>
  );
}
