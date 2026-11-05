import { useMemo, useState } from 'react';
import type { JournalEntry } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { JOURNAL_KINDS, seasonYields, harvestLb } from '../../core/journal.ts';
import { planningYear } from '../../core/schedule.ts';
import { seasonOfDate } from '../../core/succession.ts';
import { PLANTS, PLANT_BY_ID } from '../../core/plants.ts';
import { fmtDate, isoDate, parseIso, uid } from '../../core/util.ts';
import { Stat } from '../components/Chart.tsx';
import { Field, NumberInput } from '../components/Field.tsx';

export function JournalView() {
  const { garden, update } = useGarden();
  const today = new Date();
  const [season, setSeason] = useState(() => seasonOfDate(garden.site, today));
  const [filterKind, setFilterKind] = useState<string>('');
  const [filterBed, setFilterBed] = useState<string>('');
  const [draft, setDraft] = useState<Omit<JournalEntry, 'id'>>({ date: isoDate(today), kind: 'harvest', qty: 1, unit: 'lb' });

  const yields = useMemo(() => seasonYields(garden, season).filter((y) => y.expectedLb > 0 || y.harvestedLb > 0), [garden, season]);
  const entries = garden.journal
    .filter((e) => seasonOfDate(garden.site, parseIso(e.date)) === season)
    .filter((e) => !filterKind || e.kind === filterKind)
    .filter((e) => !filterBed || e.bedId === filterBed)
    .sort((a, b) => b.date.localeCompare(a.date));
  const totalLb = garden.journal.filter((e) => seasonOfDate(garden.site, parseIso(e.date)) === season).reduce((s, e) => s + (harvestLb(e) ?? 0), 0);
  const area = garden.beds.reduce((s, b) => s + b.widthFt * b.lengthFt, 0);
  const crops = [...new Set(garden.beds.flatMap((b) => b.plantings.map((p) => p.plantId)))];

  const save = () => {
    const e: JournalEntry = { id: uid('j'), ...draft, text: draft.text?.trim() || undefined };
    if (e.kind !== 'harvest') {
      delete e.qty;
      delete e.unit;
    }
    update((g) => ({ ...g, journal: [...g.journal, e] }));
    setDraft({ ...draft, text: '' });
  };

  const exportCsv = () => {
    const rows = [['date', 'kind', 'bed', 'crop', 'qty', 'unit', 'note']];
    for (const e of [...garden.journal].sort((a, b) => a.date.localeCompare(b.date)))
      rows.push([e.date, e.kind, garden.beds.find((b) => b.id === e.bedId)?.name ?? '', PLANT_BY_ID[e.plantId ?? '']?.name ?? '', e.qty?.toString() ?? '', e.unit ?? '', e.text ?? '']);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'garden-journal.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="view journal-view">
      <div className="row between wrap gap">
        <div className="row gap">
          <button onClick={() => setSeason(season - 1)} aria-label="Previous season">‹</button>
          <h2>Journal {season}</h2>
          <button onClick={() => setSeason(season + 1)} aria-label="Next season" disabled={season >= planningYear(garden.site, today)}>›</button>
        </div>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="journal-layout">
        <div className="col">
          <section className="card">
            <h3>New entry</h3>
            <div className="grid3">
              <Field label="Date"><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
              <Field label="Type">
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as JournalEntry['kind'] })}>
                  {JOURNAL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
                </select>
              </Field>
              <Field label="Bed">
                <select value={draft.bedId ?? ''} onChange={(e) => setDraft({ ...draft, bedId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {garden.beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Crop">
                <select value={draft.plantId ?? ''} onChange={(e) => setDraft({ ...draft, plantId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {(crops.length ? crops.map((c) => PLANT_BY_ID[c]) : PLANTS).filter(Boolean).map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                </select>
              </Field>
              {draft.kind === 'harvest' && (
                <Field label="Amount">
                  <span className="row gap">
                    <NumberInput value={draft.qty ?? 0} min={0} step={0.25} onChange={(v) => setDraft({ ...draft, qty: v })} />
                    <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as JournalEntry['unit'] })} aria-label="Unit">
                      {(['lb', 'oz', 'kg', 'g', 'count', 'bunch'] as const).map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </span>
                </Field>
              )}
            </div>
            <Field label="Notes"><input value={draft.text ?? ''} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="What you saw or did" /></Field>
            <button className="primary" onClick={save} disabled={draft.kind === 'harvest' && !draft.plantId}>Add entry</button>
          </section>

          <section className="card">
            <div className="row between wrap gap">
              <h3>Entries</h3>
              <span className="row gap">
                <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} aria-label="Filter type">
                  <option value="">All types</option>
                  {JOURNAL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
                <select value={filterBed} onChange={(e) => setFilterBed(e.target.value)} aria-label="Filter bed">
                  <option value="">All beds</option>
                  {garden.beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </span>
            </div>
            {entries.length === 0 && <p className="muted">No entries yet for {season}. Harvests logged from Today or Beds show up here.</p>}
            <ul className="journal-list">
              {entries.map((e) => {
                const k = JOURNAL_KINDS.find((x) => x.id === e.kind);
                return (
                  <li key={e.id}>
                    <span className="tabular muted">{fmtDate(e.date)}</span>
                    <span aria-hidden="true">{k?.icon}</span>
                    <span className="grow">
                      <b>{k?.label}</b>
                      {e.plantId && <> · {PLANT_BY_ID[e.plantId]?.name}</>}
                      {e.bedId && <span className="muted"> · {garden.beds.find((b) => b.id === e.bedId)?.name}</span>}
                      {e.kind === 'harvest' && e.qty != null && <> · <b className="tabular">{e.qty} {e.unit}</b></>}
                      {e.text && <span className="block small">{e.text}</span>}
                    </span>
                    <button className="link small" onClick={() => update((g) => ({ ...g, journal: g.journal.filter((x) => x.id !== e.id) }))} aria-label="Delete entry">✕</button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="side-col">
          <section className="card">
            <h3>Harvest {season}</h3>
            <div className="stats">
              <Stat label="Harvested" value={`${totalLb.toFixed(1)} lb`} sub={area ? `${(totalLb / area).toFixed(2)} lb per sq ft of bed` : undefined} />
              <Stat label="Plan expects" value={`${yields.reduce((s, y) => s + y.expectedLb, 0).toFixed(0)} lb`} sub="typical home-garden yields" />
            </div>
            {yields.length > 0 && (
              <ul className="yield-list" aria-label="Harvested versus expected by crop">
                {yields.map((y) => {
                  const p = PLANT_BY_ID[y.plantId];
                  const max = Math.max(y.expectedLb, y.harvestedLb, 0.01);
                  return (
                    <li key={y.plantId}>
                      <div className="row between small"><span><span aria-hidden="true">{p?.icon}</span> {p?.name}</span><span className="tabular">{y.harvestedLb.toFixed(1)}{y.harvestedCount ? ` lb + ${y.harvestedCount} ct` : ''} / {y.expectedLb.toFixed(1)} lb</span></div>
                      <div className="yield-track"><div className="yield-fill" style={{ width: `${Math.min(100, (y.harvestedLb / max) * 100)}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="muted small">Bars show harvested weight against the plan’s typical yield. Counts and bunches are listed but not weighed.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
